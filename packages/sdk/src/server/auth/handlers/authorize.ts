import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { OAuthServerProvider } from "../provider.js";
import fastifyRateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import {
  InvalidRequestError,
  InvalidClientError,
  InvalidScopeError,
  ServerError,
  TooManyRequestsError,
  OAuthError,
  MethodNotAllowedError,
} from "../errors.js";
import type { OAuthClientInformationFull } from "../../../shared/auth.js";

export type AuthorizationHandlerOptions = {
  provider: OAuthServerProvider;
  /**
   * Rate limiting configuration for the authorization endpoint.
   * Set to false to disable rate limiting for this endpoint.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
};

// Parameters that must be validated in order to issue redirects.
const ClientAuthorizationParamsSchema = z.object({
  client_id: z.string(),
  redirect_uri: z
    .string()
    .optional()
    .refine((value) => value === undefined || URL.canParse(value), {
      message: "redirect_uri must be a valid URL",
    }),
});

// Parameters that must be validated for a successful authorization request. Failure can be reported to the redirect URI.
const RequestAuthorizationParamsSchema = z.object({
  response_type: z.literal("code"),
  code_challenge: z.string(),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
});

// Helper function to create error redirect URLs
function createErrorRedirect(
  redirectUri: string,
  error: OAuthError,
  state?: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error.errorCode);
  url.searchParams.set("error_description", error.message);
  if (error.errorUri) {
    url.searchParams.set("error_uri", error.errorUri);
  }
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

export function authorizationPlugin({
  provider,
  rateLimit: rateLimitConfig,
}: AuthorizationHandlerOptions): FastifyPluginAsync {
  return async (fastify) => {
    // Apply rate limiting unless explicitly disabled
    if (rateLimitConfig !== false) {
      await fastify.register(fastifyRateLimit, {
        max: 100,
        timeWindow: "15 minutes",
        errorResponseBuilder: () => {
          const error = new TooManyRequestsError(
            "You have exceeded the rate limit for authorization requests"
          );
          return error.toResponseObject();
        },
        ...rateLimitConfig,
      });
    }

    // Handle allowed methods
    fastify.addHook("onRequest", async (request, reply) => {
      if (request.method !== "GET" && request.method !== "POST") {
        const error = new MethodNotAllowedError(
          `Method ${request.method} not allowed, use GET or POST`
        );
        reply.code(405).send(error.toResponseObject());
        return reply;
      }
    });

    fastify.route({
      method: ["GET", "POST"],
      url: "/",
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-store");

        // In the authorization flow, errors are split into two categories:
        // 1. Pre-redirect errors (direct response with 400)
        // 2. Post-redirect errors (redirect with error parameters)

        // Get parameters from query or body depending on method
        const params = request.method === "POST" ? request.body : request.query;

        // Phase 1: Validate client_id and redirect_uri. Any errors here must be direct responses.
        let client_id: string;
        let redirect_uri: string;
        let client: OAuthClientInformationFull | undefined;
        try {
          const result = ClientAuthorizationParamsSchema.safeParse(params);
          if (!result.success) {
            throw new InvalidRequestError(result.error.message);
          }

          client_id = result.data.client_id;
          redirect_uri = result.data.redirect_uri as string;

          client = await provider.clientsStore.getClient(client_id);
          if (!client) {
            throw new InvalidClientError("Invalid client_id");
          }

          if (redirect_uri !== undefined) {
            if (!client.redirect_uris.includes(redirect_uri)) {
              throw new InvalidRequestError("Unregistered redirect_uri");
            }
          } else if (client.redirect_uris.length === 1) {
            redirect_uri = client.redirect_uris[0] as string;
          } else {
            throw new InvalidRequestError(
              "redirect_uri must be specified when client has multiple registered URIs"
            );
          }
        } catch (error) {
          // Pre-redirect errors - return direct response
          //
          // These don't need to be JSON encoded, as they'll be displayed in a user
          // agent, but OTOH they all represent exceptional situations (arguably,
          // "programmer error"), so presenting a nice HTML page doesn't help the
          // user anyway.
          if (error instanceof OAuthError) {
            const status = error instanceof ServerError ? 500 : 400;
            reply.code(status).send(error.toResponseObject());
          } else {
            console.error("Unexpected error looking up client:", error);
            const serverError = new ServerError("Internal Server Error");
            reply.code(500).send(serverError.toResponseObject());
          }

          return;
        }

        // Phase 2: Validate other parameters. Any errors here should go into redirect responses.
        let state: string | undefined;
        try {
          // Parse and validate authorization parameters
          const parseResult =
            RequestAuthorizationParamsSchema.safeParse(params);
          if (!parseResult.success) {
            throw new InvalidRequestError(parseResult.error.message);
          }

          const { scope, code_challenge } = parseResult.data;
          state = parseResult.data.state;

          // Validate scopes
          let requestedScopes: string[] = [];
          if (scope !== undefined) {
            requestedScopes = scope.split(" ");
            const allowedScopes = new Set(client.scope?.split(" "));

            // Check each requested scope against allowed scopes
            for (const scope of requestedScopes) {
              if (!allowedScopes.has(scope)) {
                throw new InvalidScopeError(
                  `Client was not registered with scope ${scope}`
                );
              }
            }
          }

          // All validation passed, proceed with authorization
          await provider.authorize(
            client,
            {
              state,
              scopes: requestedScopes,
              redirectUri: redirect_uri,
              codeChallenge: code_challenge,
            },
            reply
          );
        } catch (error) {
          // Post-redirect errors - redirect with error parameters
          if (error instanceof OAuthError) {
            reply.redirect(
              createErrorRedirect(redirect_uri, error, state),
              302
            );
          } else {
            console.error("Unexpected error during authorization:", error);
            const serverError = new ServerError("Internal Server Error");
            reply.redirect(
              createErrorRedirect(redirect_uri, serverError, state),
              302
            );
          }
        }
      },
    });
  };
}
