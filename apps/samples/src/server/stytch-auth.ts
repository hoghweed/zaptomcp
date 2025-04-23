import type { FastifyInstance } from "fastify";
import type { FastifyAuthFunction } from "@fastify/auth";
import { z } from "zod";
import * as Stytch from "stytch";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: FastifyAuthFunction;
    stytchClient: Stytch.B2BClient;
  }
}

export async function setupStytchAuth(fastify: FastifyInstance) {
  // Register JWT plugin
  await fastify.register(import("@fastify/jwt"), {
    secret: process.env.JWT_SECRET || "your-secret-key",
    cookie: {
      cookieName: "token",
      signed: true,
    },
  });

  // Register cookie plugin
  await fastify.register(import("@fastify/cookie"), {
    secret: process.env.COOKIE_SECRET || "your-cookie-secret",
    parseOptions: {},
  });

  // Register auth plugin
  await fastify.register(import("@fastify/auth"));

  // Initialize Stytch client
  const stytchClient = new Stytch.B2BClient({
    project_id: process.env.STYTCH_PROJECT_ID || "mock-project-id",
    secret: process.env.STYTCH_SECRET || "mock-secret",
  });

  // Add Stytch client to server instance
  fastify.decorate("stytchClient", stytchClient);

  // Define authentication function
  fastify.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  // Add callback schema
  const callbackSchema = z.object({
    token: z.string(),
    stytch_token_type: z.enum([
      "oauth",
      "discovery_oauth",
      "discovery",
      "multi_tenant_magic_links",
      "sso",
    ]),
    slug: z.string().optional(),
  });

  // Add callback route
  fastify.get(
    "/auth/callback",
    {
      schema: {
        querystring: callbackSchema,
      },
    },
    async (request, reply) => {
      const { token } = request.query as z.infer<
        typeof callbackSchema
      >;

      try {
        // Authenticate with Stytch
        const session = await fastify.stytchClient.magicLinks.authenticate({
          magic_links_token: token,
          session_duration_minutes: 60,
        });

        // Create JWT with Stytch session info
        const jwtToken = await reply.jwtSign({
          stytch_session_token: session.session_token,
          stytch_organization_id: session.organization_id,
        });

        // Set cookie
        reply.setCookie("token", jwtToken, {
          path: "/",
          secure: process.env.NODE_ENV === "production",
          httpOnly: true,
          sameSite: "strict",
        });

        return {
          message: "Authentication successful",
          session_token: session.session_token,
          organization_id: session.organization_id,
        };
      } catch (error) {
        console.error("Stytch authentication error:", error);
        reply.statusCode = 401;
        return {
          message: "Authentication failed",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );
}
