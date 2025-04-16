import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { OAuthServerProvider } from "../provider.js";
import fastifyCors from "@fastify/cors";
import {verifyChallenge} from "pkce-challenge";
import { authenticateClient } from "../plugins/client-auth.js";
import fastifyRateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import {
  InvalidRequestError,
  InvalidGrantError,
  UnsupportedGrantTypeError,
  ServerError,  
  TooManyRequestsError,
  OAuthError,
  MethodNotAllowedError
} from "../errors.js";

export type TokenHandlerOptions = {
  provider: OAuthServerProvider;
  /**
   * Rate limiting configuration for the token endpoint.
   * Set to false to disable rate limiting for this endpoint.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
};

const TokenRequestSchema = z.object({
  grant_type: z.string(),
});

const AuthorizationCodeGrantSchema = z.object({
  code: z.string(),
  code_verifier: z.string(),
});

const RefreshTokenGrantSchema = z.object({
  refresh_token: z.string(),
  scope: z.string().optional(),
});

export function tokenPlugin({ provider, rateLimit: rateLimitConfig }: TokenHandlerOptions): FastifyPluginAsync {
  return async (fastify) => {
    // Configure CORS to allow any origin, to make accessible to web-based MCP clients
    await fastify.register(fastifyCors);

    // Apply rate limiting unless explicitly disabled
    if (rateLimitConfig !== false) {
      await fastify.register(fastifyRateLimit, {
        max: 50,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => {
          const error = new TooManyRequestsError('You have exceeded the rate limit for token requests');
          return error.toResponseObject();
        },
        ...rateLimitConfig
      });
    }

    // Authenticate and extract client details
    await fastify.register(authenticateClient, { clientsStore: provider.clientsStore });

    // Handle allowed methods
    fastify.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'POST') {
        const error = new MethodNotAllowedError(`Method ${request.method} not allowed, use POST`);
        reply.code(405).send(error.toResponseObject());
        return reply;
      }
    });

    fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');

      try {
        const parseResult = TokenRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          throw new InvalidRequestError(parseResult.error.message);
        }

        const { grant_type } = parseResult.data;

        const client = request.client;
        if (!client) {
          // This should never happen
          console.error("Missing client information after authentication");
          throw new ServerError("Internal Server Error");
        }

        switch (grant_type) {
          case "authorization_code": {
            const parseResult = AuthorizationCodeGrantSchema.safeParse(request.body);
            if (!parseResult.success) {
              throw new InvalidRequestError(parseResult.error.message);
            }

            const { code, code_verifier } = parseResult.data;

            const skipLocalPkceValidation = provider.skipLocalPkceValidation;

            // Perform local PKCE validation unless explicitly skipped 
            // (e.g. to validate code_verifier in upstream server)
            if (!skipLocalPkceValidation) {
              const codeChallenge = await provider.challengeForAuthorizationCode(client, code);
              if (!(await verifyChallenge(code_verifier, codeChallenge))) {
                throw new InvalidGrantError("code_verifier does not match the challenge");
              }
            }

            // Passes the code_verifier to the provider if PKCE validation didn't occur locally
            const tokens = await provider.exchangeAuthorizationCode(client, code, skipLocalPkceValidation ? code_verifier : undefined);
            return tokens;
          }

          case "refresh_token": {
            const parseResult = RefreshTokenGrantSchema.safeParse(request.body);
            if (!parseResult.success) {
              throw new InvalidRequestError(parseResult.error.message);
            }

            const { refresh_token, scope } = parseResult.data;

            const scopes = scope?.split(" ");
            const tokens = await provider.exchangeRefreshToken(client, refresh_token, scopes);
            return tokens;
          }

          // Not supported right now
          //case "client_credentials":

          default:
            throw new UnsupportedGrantTypeError(
              "The grant type is not supported by this authorization server."
            );
        }
      } catch (error) {
        if (error instanceof OAuthError) {
          const status = error instanceof ServerError ? 500 : 400;
          reply.statusCode = status;
          return error.toResponseObject();
        }
          console.error("Unexpected error exchanging token:", error);
          const serverError = new ServerError("Internal Server Error");
          reply.statusCode = 500;
          return serverError.toResponseObject();
      }
    });
  };
}