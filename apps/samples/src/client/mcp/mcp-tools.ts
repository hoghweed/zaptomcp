import { Tool } from 'langchain/tools';
import type { MultiServerMCPClient } from './mcp-session.js';

export async function load_mcp_tools(session: MultiServerMCPClient): Promise<Record<string, Tool>> {
    const mcpTools = await session.getTools();
    const langchainTools: Record<string, Tool> = {};
  
    for (const [toolName, toolFn] of Object.entries(mcpTools)) {
      langchainTools[toolName] = new MCPToolWrapper(toolName, toolFn);
    }
  
    return langchainTools;
  }

/**
 * A LangChain Tool wrapper for MCP tools
 */
class MCPToolWrapper extends Tool {
    name: string;
    description: string;
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    private toolFn: (args: any) => Promise<string>;
  
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    constructor(name: string, toolFn: (args: any) => Promise<string>) {
      super();
      this.name = name;
      this.description = `Call the ${name} MCP tool`;
      this.toolFn = toolFn;
    }
  
    /** @ignore */
    async _call(input: string): Promise<string> {
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      let args: any;
      try {
        args = JSON.parse(input);
      } catch (error) {
        // If input is not valid JSON, pass it as a string
        args = input;
      }
  
      try {
        return await this.toolFn(args);
      } catch (error) {
        return `Error calling ${this.name}: ${error}`;
      }
    }
  }