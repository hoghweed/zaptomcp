import { Client } from "@zaptomcp/sdk/client";
import { StreamableHTTPClientTransport } from "@zaptomcp/sdk/client/transports/streamable-http";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@zaptomcp/sdk/client/transports/stdio";
import type { CallToolRequest } from "@zaptomcp/sdk/types";

/**
 * MultiServerMCPClient - A client that can connect to multiple MCP servers
 * and load tools from them.
 */
export class MultiServerMCPClient {
  private clients: Map<string, Client> = new Map();
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  private tools: Record<string, any> = {};

  /**
   * Constructor for MultiServerMCPClient
   * @param serverConfigs - Configuration for each server
   */
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  constructor(private serverConfigs: Record<string, any>) {}

  /**
   * Initialize connections to all configured servers
   */
  async initialize(): Promise<void> {
    for (const [serverName, config] of Object.entries(this.serverConfigs)) {
      const client = new Client({
        name: "example-client",
        version: "1.0.0",
      });
      // biome-ignore lint/style/useConst: <explanation>
      let sessionId: string | undefined = undefined;

      if (config.transport === "stdio") {
        const params: StdioServerParameters = {
          command: config.command,
          args: config.args || [],
          env: config.env || {},
        };

        const transport = new StdioClientTransport(params);
        client.onerror = (error) => {
          console.error("\x1b[31mClient error:", error, "\x1b[0m");
        };
        client.connect(transport);
        this.clients.set(serverName, client);
      } else if (config.transport === "sse") {
        throw new Error("SSE transport not yet implemented");
      } else if (config.transport === "streamable-http") {
        const transport = new StreamableHTTPClientTransport(
          new URL(config.url),
          {
            sessionId: sessionId as unknown as string,
          }
        );
        await client.connect(transport);
        sessionId = transport.sessionId;
        this.clients.set(serverName, client);
      } else {
        throw new Error(`Unknown transport: ${config.transport}`);
      }
    }
  }

  /**
   * Get all tools from all connected servers
   */

  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  async getTools(): Promise<Record<string, any>> {
    if (this.clients.size === 0) {
      throw new Error("No sessions initialized. Call initialize() first.");
    }

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const toolsList = await client.listTools();

        for (const tool of toolsList.tools) {
          const toolName = `${serverName}.${tool.name}`;
          // biome-ignore lint/suspicious/noExplicitAny: <explanation>
          this.tools[toolName] = async (args: any) => {
            const request: CallToolRequest = {
              method: "tools/call",
              params: {
                name: tool.name,
                arguments: args,
              },
            };
            const result = await client.callTool(request.params);
            if (!result.content || !Array.isArray(result.content)) {
              return "";
            }
            return result.content[0]?.text || "";
          };
        }
      } catch (error) {
        console.error(`Error loading tools from ${serverName}:`, error);
      }
    }

    return this.tools;
  }

  /**
   * Close all sessions
   */
  async close(): Promise<void> {
    for (const session of this.clients.values()) {
      await session.close();
    }
    this.clients.clear();
  }
}
