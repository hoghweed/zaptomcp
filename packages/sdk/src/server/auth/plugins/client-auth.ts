import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { OAuthRegisteredClientsStore } from "../clients.js";
import type { OAuthClientInformationFull } from "../../../shared/auth.js";
import {
  InvalidRequestError,
  InvalidClientError,
  ServerError,
  OAuthError,
} from "../errors.js";

export type ClientAuthenticationMiddlewareOptions = {
  /**
   * A store used to read information about registered OAuth clients.
   */
  clientsStore: OAuthRegisteredClientsStore;
};

const ClientAuthenticatedRequestSchema = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(),
});

// Extend FastifyRequest to include client property
declare module "fastify" {
  interface FastifyRequest {
    /**
     * The authenticated client for this request, if the `authenticateClient` middleware was used.
     */
    client?: OAuthClientInformationFull;
  }
}

export const authenticateClient: FastifyPluginAsync<
  ClientAuthenticationMiddlewareOptions
> = async (fastify, { clientsStore }) => {
  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = ClientAuthenticatedRequestSchema.safeParse(request.body);
        if (!result.success) {
          throw new InvalidRequestError(String(result.error));
        }

        const { client_id, client_secret } = result.data;
        const client = await clientsStore.getClient(client_id);
        if (!client) {
          throw new InvalidClientError("Invalid client_id");
        }

        // If client has a secret, validate it
        if (client.client_secret) {
          // Check if client_secret is required but not provided
          if (!client_secret) {
            throw new InvalidClientError("Client secret is required");
          }

          // Check if client_secret matches
          if (client.client_secret !== client_secret) {
            throw new InvalidClientError("Invalid client_secret");
          }

          // Check if client_secret has expired
          if (
            client.client_secret_expires_at &&
            client.client_secret_expires_at < Math.floor(Date.now() / 1000)
          ) {
            throw new InvalidClientError("Client secret has expired");
          }
        }

        request.client = client;
      } catch (error) {
        if (error instanceof OAuthError) {
          const status = error instanceof ServerError ? 500 : 400;
          reply.code(status).send(error.toResponseObject());
          return reply;
        }
        console.error("Unexpected error authenticating client:", error);
        const serverError = new ServerError("Internal Server Error");
        reply.code(500).send(serverError.toResponseObject());
        return reply;
      }
    }
  );
};
