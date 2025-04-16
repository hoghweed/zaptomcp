import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { OAuthMetadata } from "../../../shared/auth.js";
import fastifyCors from '@fastify/cors';
import { MethodNotAllowedError } from "../errors.js";

export function metadataPlugin(metadata: OAuthMetadata): FastifyPluginAsync {
  return async (fastify) => {
    // Configure CORS to allow any origin, to make accessible to web-based MCP clients
    await fastify.register(fastifyCors);

    // Handle allowed methods
    fastify.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET') {
        const error = new MethodNotAllowedError(`Method ${request.method} not allowed, use GET`);
        reply.code(405).send(error.toResponseObject());
        return reply;
      }
    });

    fastify.get('/', async (_: FastifyRequest, __: FastifyReply) => {
      return metadata;
    });
  };
}