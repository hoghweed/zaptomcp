import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import type { OAuthServerProvider } from "./provider.js";
import { tokenPlugin, type TokenHandlerOptions } from "./handlers/token.js";
import { revocationPlugin, type RevocationHandlerOptions } from "./handlers/revoke.js";
import { clientRegistrationPlugin, type ClientRegistrationHandlerOptions } from "./handlers/register.js";
import { authorizationPlugin, type AuthorizationHandlerOptions } from "./handlers/authorize.js";
import { metadataPlugin } from "./handlers/metadata.js";

export type AuthRouterOptions = {
    /**
     * A provider implementing the actual authorization logic for this router.
     */
    provider: OAuthServerProvider;
  
    /**
     * The authorization server's issuer identifier, which is a URL that uses the "https" scheme and has no query or fragment components.
     */
    issuerUrl: URL;
  
    /**
     * The base URL of the authorization server to use for the metadata endpoints.
     * 
     * If not provided, the issuer URL will be used as the base URL.
     */
    baseUrl?: URL;
  
    /**
     * An optional URL of a page containing human-readable information that developers might want or need to know when using the authorization server.
     */
    serviceDocumentationUrl?: URL;
  
    // Individual options per route
    authorizationOptions?: Omit<AuthorizationHandlerOptions, "provider">;
    clientRegistrationOptions?: Omit<ClientRegistrationHandlerOptions, "clientsStore">;
    revocationOptions?: Omit<RevocationHandlerOptions, "provider">;
    tokenOptions?: Omit<TokenHandlerOptions, "provider">;
  };

  /**
 * Installs standard MCP authorization endpoints, including dynamic client registration and token revocation (if supported). Also advertises standard authorization server metadata, for easier discovery of supported configurations by clients.
 * 
 * By default, rate limiting is applied to all endpoints to prevent abuse.
 * 
 * This plugin MUST be registered at the application root, like so:
 * 
 *  const app = fastify();
 *  await app.register(mcpAuthPlugin, {...});
 */
export const mcpAuthPlugin: FastifyPluginAsync<AuthRouterOptions> = async (fastify: FastifyInstance, options: AuthRouterOptions) => {
    const issuer = options.issuerUrl;
    const baseUrl = options.baseUrl;
  
    // Technically RFC 8414 does not permit a localhost HTTPS exemption, but this will be necessary for ease of testing
    if (issuer.protocol !== "https:" && issuer.hostname !== "localhost" && issuer.hostname !== "127.0.0.1") {
      throw new Error("Issuer URL must be HTTPS");
    }
    if (issuer.hash) {
      throw new Error("Issuer URL must not have a fragment");
    }
    if (issuer.search) {
      throw new Error("Issuer URL must not have a query string");
    }
  
    const authorization_endpoint = "/authorize";
    const token_endpoint = "/token";
    const registration_endpoint = options.provider.clientsStore.registerClient ? "/register" : undefined;
    const revocation_endpoint = options.provider.revokeToken ? "/revoke" : undefined;
  
    const metadata = {
      issuer: issuer.href,
      service_documentation: options.serviceDocumentationUrl?.href,
  
      authorization_endpoint: new URL(authorization_endpoint, baseUrl || issuer).href,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
  
      token_endpoint: new URL(token_endpoint, baseUrl || issuer).href,
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      grant_types_supported: ["authorization_code", "refresh_token"],
  
      revocation_endpoint: revocation_endpoint ? new URL(revocation_endpoint, baseUrl || issuer).href : undefined,
      revocation_endpoint_auth_methods_supported: revocation_endpoint ? ["client_secret_post"] : undefined,
  
      registration_endpoint: registration_endpoint ? new URL(registration_endpoint, baseUrl || issuer).href : undefined,
    };
  
    // Register routes
    fastify.register(authorizationPlugin({ provider: options.provider, ...options.authorizationOptions }), { prefix: authorization_endpoint });
    
    fastify.register(tokenPlugin({ provider: options.provider, ...options.tokenOptions }), { prefix: token_endpoint });
    
    fastify.register(metadataPlugin(metadata), { prefix: "/.well-known/oauth-authorization-server" });
  
    if (registration_endpoint) {
      fastify.register(clientRegistrationPlugin({
        clientsStore: options.provider.clientsStore,
        ...options.clientRegistrationOptions,
      }), { prefix: registration_endpoint });
    }
  
    if (revocation_endpoint) {
      fastify.register(revocationPlugin({ provider: options.provider, ...options.revocationOptions }), { prefix: revocation_endpoint });
    }
  };