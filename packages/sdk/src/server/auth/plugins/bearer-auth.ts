import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  InsufficientScopeError,
  InvalidTokenError,
  OAuthError,
  ServerError,
} from "../errors.js";
import type { OAuthServerProvider } from "../provider.js";
import type { AuthInfo } from "../types.js";

export type BearerAuthMiddlewareOptions = {
  /**
   * A provider used to verify tokens.
   */
  provider: OAuthServerProvider;

  /**
   * Optional scopes that the token must have.
   */
  requiredScopes?: string[];
};

// Extend FastifyRequest to include auth property
declare module "fastify" {
  interface FastifyRequest {
    /**
     * Information about the validated access token, if the `requireBearerAuth` middleware was used.
     */
    auth?: AuthInfo;
  }
}

/**
 * Plugin that requires a valid Bearer token in the Authorization header.
 *
 * This will validate the token with the auth provider and add the resulting auth info to the request object.
 */
export const requireBearerAuth: FastifyPluginAsync<
  BearerAuthMiddlewareOptions
> = async (fastify, { provider, requiredScopes = [] }) => {
  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader) {
          throw new InvalidTokenError("Missing Authorization header");
        }

        const [type, token] = authHeader.split(" ");
        if (!type || type.toLowerCase() !== "bearer" || !token) {
          throw new InvalidTokenError(
            "Invalid Authorization header format, expected 'Bearer TOKEN'"
          );
        }

        const authInfo = await provider.verifyAccessToken(token);

        // Check if token has the required scopes (if any)
        if (requiredScopes.length > 0) {
          const hasAllScopes = requiredScopes.every((scope) =>
            authInfo.scopes.includes(scope)
          );

          if (!hasAllScopes) {
            throw new InsufficientScopeError("Insufficient scope");
          }
        }

        // Check if the token is expired
        if (!!authInfo.expiresAt && authInfo.expiresAt < Date.now() / 1000) {
          throw new InvalidTokenError("Token has expired");
        }

        request.auth = authInfo;
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          reply.header(
            "WWW-Authenticate",
            `Bearer error="${error.errorCode}", error_description="${error.message}"`
          );
          reply.code(401).send(error.toResponseObject());
          return reply;
        }
        if (error instanceof InsufficientScopeError) {
          reply.header(
            "WWW-Authenticate",
            `Bearer error="${error.errorCode}", error_description="${error.message}"`
          );
          reply.code(403).send(error.toResponseObject());
          return reply;
        }
        if (error instanceof ServerError) {
          reply.code(500).send(error.toResponseObject());
          return reply;
        }
        if (error instanceof OAuthError) {
          reply.code(400).send(error.toResponseObject());
          return reply;
        }
        console.error("Unexpected error authenticating bearer token:", error);
        const serverError = new ServerError("Internal Server Error");
        reply.code(500).send(serverError.toResponseObject());
        return reply;
      }
    }
  );
};
