export class ZapMCP<T extends Record<string, unknown> | undefined = undefined> extends FastMCPEventEmitter {
    #options: ServerOptions<T>;
    #prompts: InputPrompt[] = [];
    #resources: Resource[] = [];
    #resourcesTemplates: InputResourceTemplate[] = [];
    #sessions: FastMCPSession<T>[] = [];
    #sseServer: SSEServer | null = null;
    #tools: Tool<T>[] = [];
    #authenticate: Authenticate<T> | undefined;
  
    constructor(public options: ServerOptions<T>) {
      super();
  
      this.#options = options;
      this.#authenticate = options.authenticate;
    }
  
    public get sessions(): FastMCPSession<T>[] {
      return this.#sessions;
    }
  
    /**
     * Adds a tool to the server.
     */
    public addTool<Params extends ToolParameters>(tool: Tool<T, Params>) {
      this.#tools.push(tool as unknown as Tool<T>);
    }
  
    /**
     * Adds a resource to the server.
     */
    public addResource(resource: Resource) {
      this.#resources.push(resource);
    }
  
    /**
     * Adds a resource template to the server.
     */
    public addResourceTemplate<
      const Args extends InputResourceTemplateArgument[],
    >(resource: InputResourceTemplate<Args>) {
      this.#resourcesTemplates.push(resource);
    }
  
    /**
     * Adds a prompt to the server.
     */
    public addPrompt<const Args extends InputPromptArgument[]>(
      prompt: InputPrompt<Args>,
    ) {
      this.#prompts.push(prompt);
    }
  
    /**
     * Starts the server.
     */
    public async start(
      options:
        | { transportType: "stdio" }
        | {
            transportType: "sse";
            sse: { endpoint: `/${string}`; port: number };
          } = {
        transportType: "stdio",
      },
    ) {
      if (options.transportType === "stdio") {
        const transport = new StdioServerTransport();
  
        const session = new FastMCPSession<T>({
          name: this.#options.name,
          version: this.#options.version,
          tools: this.#tools,
          resources: this.#resources,
          resourcesTemplates: this.#resourcesTemplates,
          prompts: this.#prompts,
        });
  
        await session.connect(transport);
  
        this.#sessions.push(session);
  
        this.emit("connect", {
          session,
        });
  
      } else if (options.transportType === "sse") {
        this.#sseServer = await startSSEServer<FastMCPSession<T>>({
          endpoint: options.sse.endpoint as `/${string}`,
          port: options.sse.port,
          createServer: async (request) => {
            let auth: T | undefined;
  
            if (this.#authenticate) {
              auth = await this.#authenticate(request);
            }
  
            return new FastMCPSession<T>({
              auth,
              name: this.#options.name,
              version: this.#options.version,
              tools: this.#tools,
              resources: this.#resources,
              resourcesTemplates: this.#resourcesTemplates,
              prompts: this.#prompts,
            });
          },
          onClose: (session) => {
            this.emit("disconnect", {
              session,
            });
          },
          onConnect: async (session) => {
            this.#sessions.push(session);
  
            this.emit("connect", {
              session,
            });
          },
        });
  
        console.info(
          `server is running on SSE at http://localhost:${options.sse.port}${options.sse.endpoint}`,
        );
      } else {
        throw new Error("Invalid transport type");
      }
    }
  
    /**
     * Stops the server.
     */
    public async stop() {
      if (this.#sseServer) {
        this.#sseServer.close();
      }
    }
  }
  