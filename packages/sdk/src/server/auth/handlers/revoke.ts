import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { OAuthServerProvider } from "../provider.js";
import fastifyCors from "@fastify/cors";
import { authenticateClient } from "../plugins/client-auth.js";
import { OAuthTokenRevocationRequestSchema } from "../../../shared/auth.js";
import fastifyRateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import {
  InvalidRequestError,
  ServerError,
  TooManyRequestsError,
  OAuthError,
  MethodNotAllowedError,
} from "../errors.js";

export type RevocationHandlerOptions = {
  provider: OAuthServerProvider;
  /**
   * Rate limiting configuration for the token revocation endpoint.
   * Set to false to disable rate limiting for this endpoint.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
};

export function revocationPlugin({
  provider,
  rateLimit: rateLimitConfig,
}: RevocationHandlerOptions): FastifyPluginAsync {
  if (!provider.revokeToken) {
    throw new Error("Auth provider does not support revoking tokens");
  }

  return async (fastify) => {
    // Configure CORS to allow any origin, to make accessible to web-based MCP clients
    await fastify.register(fastifyCors);

    // Apply rate limiting unless explicitly disabled
    if (rateLimitConfig !== false) {
      await fastify.register(fastifyRateLimit, {
        max: 50,
        timeWindow: "15 minutes",
        errorResponseBuilder: () => {
          const error = new TooManyRequestsError(
            "You have exceeded the rate limit for token revocation requests"
          );
          return error.toResponseObject();
        },
        ...rateLimitConfig,
      });
    }

    // Authenticate and extract client details
    await fastify.register(authenticateClient, {
      clientsStore: provider.clientsStore,
    });

    // Handle allowed methods
    fastify.addHook("onRequest", async (request, reply) => {
      if (request.method !== "POST") {
        const error = new MethodNotAllowedError(
          `Method ${request.method} not allowed, use POST`
        );
        reply.code(405).send(error.toResponseObject());
        return reply;
      }
    });

    fastify.post("/", async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Cache-Control", "no-store");

      try {
        const parseResult = OAuthTokenRevocationRequestSchema.safeParse(
          request.body
        );
        if (!parseResult.success) {
          throw new InvalidRequestError(parseResult.error.message);
        }

        const client = request.client;
        if (!client) {
          // This should never happen
          console.error("Missing client information after authentication");
          throw new ServerError("Internal Server Error");
        }

        await provider.revokeToken?.(client, parseResult.data);
        return {};
      } catch (error) {
        if (error instanceof OAuthError) {
          const status = error instanceof ServerError ? 500 : 400;
          reply.statusCode = status;
          return error.toResponseObject();
        }
        console.error("Unexpected error revoking token:", error);
        const serverError = new ServerError("Internal Server Error");
        reply.statusCode = 500;
        return serverError.toResponseObject();
      }
    });
  };
}
