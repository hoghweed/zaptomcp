import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { OAuthClientMetadataSchema, type OAuthClientInformationFull } from "../../../shared/auth.js";
import crypto from 'node:crypto';
import fastifyCors from '@fastify/cors';
import type { OAuthRegisteredClientsStore } from "../clients.js";
import fastifyRateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import {
  InvalidClientMetadataError,
  ServerError,
  TooManyRequestsError,
  OAuthError,
  MethodNotAllowedError
} from "../errors.js";

export type ClientRegistrationHandlerOptions = {
  /**
   * A store used to save information about dynamically registered OAuth clients.
   */
  clientsStore: OAuthRegisteredClientsStore;

  /**
   * The number of seconds after which to expire issued client secrets, or 0 to prevent expiration of client secrets (not recommended).
   * 
   * If not set, defaults to 30 days.
   */
  clientSecretExpirySeconds?: number;

  /**
   * Rate limiting configuration for the client registration endpoint.
   * Set to false to disable rate limiting for this endpoint.
   * Registration endpoints are particularly sensitive to abuse and should be rate limited.
   */
  rateLimit?: Partial<RateLimitOptions> | false;
};

const DEFAULT_CLIENT_SECRET_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function clientRegistrationPlugin({
  clientsStore,
  clientSecretExpirySeconds = DEFAULT_CLIENT_SECRET_EXPIRY_SECONDS,
  rateLimit: rateLimitConfig
}: ClientRegistrationHandlerOptions): FastifyPluginAsync {
  if (!clientsStore.registerClient) {
    throw new Error("Client registration store does not support registering clients");
  }

  return async (fastify) => {
    // Configure CORS to allow any origin, to make accessible to web-based MCP clients
    await fastify.register(fastifyCors);

    // Apply rate limiting unless explicitly disabled - stricter limits for registration
    if (rateLimitConfig !== false) {
      await fastify.register(fastifyRateLimit, {
        max: 20,
        timeWindow: '1h', // 1 hour
        errorResponseBuilder: () => {
          const error = new TooManyRequestsError('You have exceeded the rate limit for client registration requests');
          return error.toResponseObject();
        },
        ...rateLimitConfig
      });
    }

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
        const parseResult = OAuthClientMetadataSchema.safeParse(request.body);
        if (!parseResult.success) {
          throw new InvalidClientMetadataError(parseResult.error.message);
        }

        const clientMetadata = parseResult.data;
        const isPublicClient = clientMetadata.token_endpoint_auth_method === 'none'

        // Generate client credentials
        const clientId = crypto.randomUUID();
        const clientSecret = isPublicClient
          ? undefined
          : crypto.randomBytes(32).toString('hex');
        const clientIdIssuedAt = Math.floor(Date.now() / 1000);

        // Calculate client secret expiry time
        const clientsDoExpire = clientSecretExpirySeconds > 0
        const secretExpiryTime = clientsDoExpire ? clientIdIssuedAt + clientSecretExpirySeconds : 0
        const clientSecretExpiresAt = isPublicClient ? undefined : secretExpiryTime

        let clientInfo: OAuthClientInformationFull = {
          ...clientMetadata,
          client_id: clientId,
          client_secret: clientSecret,
          client_id_issued_at: clientIdIssuedAt,
          client_secret_expires_at: clientSecretExpiresAt,
        };

        const registeredClient = await clientsStore.registerClient?.(clientInfo);
        if (!registeredClient) {
            throw new ServerError("Failed to register client");
        }
        clientInfo = registeredClient;
        reply.code(201).send(clientInfo);
      } catch (error) {
        if (error instanceof OAuthError) {
          const status = error instanceof ServerError ? 500 : 400;
          reply.code(status).send(error.toResponseObject());
        } else {
          console.error("Unexpected error registering client:", error);
          const serverError = new ServerError("Internal Server Error");
          reply.code(500).send(serverError.toResponseObject());
        }
      }
    });
  };
}