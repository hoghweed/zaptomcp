import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { MethodNotAllowedError } from "../errors.js";

/**
 * Plugin to handle unsupported HTTP methods with a 405 Method Not Allowed response.
 * 
 * @param allowedMethods Array of allowed HTTP methods for this endpoint (e.g., ['GET', 'POST'])
 * @returns Fastify plugin that returns a 405 error if method not in allowed list
 */
export const allowedMethods = (allowedMethods: string[]): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (allowedMethods.includes(request.method)) {
        return;
      }

      const error = new MethodNotAllowedError(`The method ${request.method} is not allowed for this endpoint`);
      reply
        .code(405)
        .header('Allow', allowedMethods.join(', '))
        .send(error.toResponseObject());
      
      return reply;
    });
  };
};