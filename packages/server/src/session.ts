import type { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import {
  type FastMCPSessionAuth,
  FastMCPSessionEventEmitter,
  type LoggingLevel,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type Tool,
  type InputResourceTemplate,
  type ArgumentValueCompleter,
  type InputPrompt,
  type SamplingResponse,
  type ContentResult,
  type Progress,
  type SerializableValue,
  CompletionZodSchema,
  ContentResultZodSchema,
  type TextContent,
  type ImageContent,
} from "./types.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
  SetLevelRequestSchema,
  type ClientCapabilities,
  type CreateMessageRequestSchema,
  type Root,
  type ServerCapabilities,
} from "@zaptomcp/sdk/types";
import { Server } from "@zaptomcp/sdk/Server";
import parseURITemplate from "uri-templates";
import Fuse from "fuse.js";
import { UnexpectedStateError, UserError } from "./errors.js";
import type { Transport } from "@zaptomcp/sdk/transports";
import { toJsonSchema } from "xsschema";

export class FastMCPSession<
  T extends FastMCPSessionAuth = FastMCPSessionAuth
> extends FastMCPSessionEventEmitter {
  #capabilities: ServerCapabilities = {};
  #clientCapabilities?: ClientCapabilities;
  #loggingLevel: LoggingLevel = "info";
  #prompts: Prompt[] = [];
  #resources: Resource[] = [];
  #resourceTemplates: ResourceTemplate[] = [];
  #roots: Root[] = [];
  #server: Server;
  #auth: T | undefined;

  constructor({
    auth,
    name,
    version,
    tools,
    resources,
    resourcesTemplates,
    prompts,
  }: {
    auth?: T;
    name: string;
    version: string;
    tools: Tool<T>[];
    resources: Resource[];
    resourcesTemplates: InputResourceTemplate[];
    prompts: Prompt[];
  }) {
    super();

    this.#auth = auth;

    if (tools.length) {
      this.#capabilities.tools = {};
    }

    if (resources.length || resourcesTemplates.length) {
      this.#capabilities.resources = {};
    }

    if (prompts.length) {
      for (const prompt of prompts) {
        this.addPrompt(prompt);
      }

      this.#capabilities.prompts = {};
    }

    this.#capabilities.logging = {};

    this.#server = new Server(
      { name: name, version: version },
      { capabilities: this.#capabilities }
    );

    this.setupErrorHandling();
    this.setupLoggingHandlers();
    this.setupRootsHandlers();
    this.setupCompleteHandlers();

    if (tools.length) {
      this.setupToolHandlers(tools);
    }

    if (resources.length || resourcesTemplates.length) {
      for (const resource of resources) {
        this.addResource(resource);
      }

      this.setupResourceHandlers(resources);

      if (resourcesTemplates.length) {
        for (const resourceTemplate of resourcesTemplates) {
          this.addResourceTemplate(resourceTemplate);
        }

        this.setupResourceTemplateHandlers(resourcesTemplates);
      }
    }

    if (prompts.length) {
      this.setupPromptHandlers(prompts);
    }
  }

  private addResource(inputResource: Resource) {
    this.#resources.push(inputResource);
  }

  private addResourceTemplate(inputResourceTemplate: InputResourceTemplate) {
    const completers: Record<string, ArgumentValueCompleter> = {};

    for (const argument of inputResourceTemplate.arguments ?? []) {
      if (argument.complete) {
        completers[argument.name] = argument.complete;
      }
    }

    const resourceTemplate = {
      ...inputResourceTemplate,
      complete: async (name: string, value: string) => {
        if (completers[name]) {
          return await completers[name](value);
        }

        return {
          values: [],
        };
      },
    };

    this.#resourceTemplates.push(resourceTemplate);
  }

  private addPrompt(inputPrompt: InputPrompt) {
    const completers: Record<string, ArgumentValueCompleter> = {};
    const enums: Record<string, string[]> = {};

    for (const argument of inputPrompt.arguments ?? []) {
      if (argument.complete) {
        completers[argument.name] = argument.complete;
      }

      if (argument.enum) {
        enums[argument.name] = argument.enum;
      }
    }

    const prompt = {
      ...inputPrompt,
      complete: async (name: string, value: string) => {
        if (completers[name]) {
          return await completers[name](value);
        }

        if (enums[name]) {
          const fuse = new Fuse(enums[name], {
            keys: ["value"],
          });

          const result = fuse.search(value);

          return {
            values: result.map((item) => item.item),
            total: result.length,
          };
        }

        return {
          values: [],
        };
      },
    };

    this.#prompts.push(prompt);
  }

  public get clientCapabilities(): ClientCapabilities | null {
    return this.#clientCapabilities ?? null;
  }

  public get server(): Server {
    return this.#server;
  }

  #pingInterval: ReturnType<typeof setInterval> | null = null;

  public async requestSampling(
    message: z.infer<typeof CreateMessageRequestSchema>["params"]
  ): Promise<SamplingResponse> {
    const response = await this.#server.createMessage(message);

    return {
      model: response.model,
      stopReason: response.stopReason,
      role: response.role,
      content: response.content as unknown as TextContent | ImageContent,
    };
  }

  public async connect(transport: Transport) {
    if (this.#server.transport) {
      throw new UnexpectedStateError("Server is already connected");
    }

    await this.#server.connect(transport);

    let attempt = 0;

    while (attempt++ < 10) {
      const capabilities = await this.#server.getClientCapabilities();

      if (capabilities) {
        this.#clientCapabilities = capabilities;

        break;
      }

      await delay(100);
    }

    if (!this.#clientCapabilities) {
      console.warn("[warning] FastMCP could not infer client capabilities");
    }

    if (this.#clientCapabilities?.roots?.listChanged) {
      try {
        const roots = await this.#server.listRoots();
        this.#roots = roots.roots;
      } catch (e) {
        console.error(
          `[error] FastMCP received error listing roots.\n\n${
            e instanceof Error ? e.stack : JSON.stringify(e)
          }`
        );
      }
    }

    this.#pingInterval = setInterval(async () => {
      try {
        await this.#server.ping();
      } catch (error) {
        this.emit("error", {
          error: error as Error,
        });
      }
    }, 1000);
  }

  public get roots(): Root[] {
    return this.#roots;
  }

  public async close() {
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
    }

    try {
      await this.#server.close();
    } catch (error) {
      console.error("[MCP Error]", "could not close server", error);
    }
  }

  private setupErrorHandling() {
    this.#server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };
  }

  public get loggingLevel(): LoggingLevel {
    return this.#loggingLevel;
  }

  private setupCompleteHandlers() {
    this.#server.setRequestHandler(CompleteRequestSchema, async (request) => {
      if (request.params.ref.type === "ref/prompt") {
        const prompt = this.#prompts.find(
          (prompt) => prompt.name === request.params.ref.name
        );

        if (!prompt) {
          throw new UnexpectedStateError("Unknown prompt", {
            request,
          });
        }

        if (!prompt.complete) {
          throw new UnexpectedStateError("Prompt does not support completion", {
            request,
          });
        }

        const completion = CompletionZodSchema.parse(
          await prompt.complete(
            request.params.argument.name,
            request.params.argument.value
          )
        );

        return {
          completion,
        };
      }

      if (request.params.ref.type === "ref/resource") {
        const resource = this.#resourceTemplates.find(
          (resource) => resource.uriTemplate === request.params.ref.uri
        );

        if (!resource) {
          throw new UnexpectedStateError("Unknown resource", {
            request,
          });
        }

        if (!("uriTemplate" in resource)) {
          throw new UnexpectedStateError("Unexpected resource");
        }

        if (!resource.complete) {
          throw new UnexpectedStateError(
            "Resource does not support completion",
            {
              request,
            }
          );
        }

        const completion = CompletionZodSchema.parse(
          await resource.complete(
            request.params.argument.name,
            request.params.argument.value
          )
        );

        return {
          completion,
        };
      }

      throw new UnexpectedStateError("Unexpected completion request", {
        request,
      });
    });
  }

  private setupRootsHandlers() {
    this.#server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      () => {
        this.#server.listRoots().then((roots) => {
          this.#roots = roots.roots;

          this.emit("rootsChanged", {
            roots: roots.roots,
          });
        });
      }
    );
  }

  private setupLoggingHandlers() {
    this.#server.setRequestHandler(SetLevelRequestSchema, (request) => {
      this.#loggingLevel = request.params.level;

      return {};
    });
  }

  private setupToolHandlers(tools: Tool<T>[]) {
    this.#server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: await Promise.all(
          tools.map(async (tool) => {
            return {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters
                ? await toJsonSchema(tool.parameters)
                : undefined,
            };
          })
        ),
      };
    });

    this.#server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((tool) => tool.name === request.params.name);

      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      // biome-ignore lint/suspicious/noExplicitAny: allowing any type for now
      let args: any = undefined;

      if (tool.parameters) {
        const parsed = await tool.parameters["~standard"].validate(
          request.params.arguments
        );

        if (parsed.issues) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid ${request.params.name} parameters`
          );
        }

        args = parsed.value;
      }

      const progressToken = request.params?._meta?.progressToken;

      let result: ContentResult;

      try {
        const reportProgress = async (progress: Progress) => {
          await this.#server.notification({
            method: "notifications/progress",
            params: {
              ...progress,
              progressToken,
            },
          });
        };

        const log = {
          debug: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "debug",
              data: {
                message,
                context,
              },
            });
          },
          error: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "error",
              data: {
                message,
                context,
              },
            });
          },
          info: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "info",
              data: {
                message,
                context,
              },
            });
          },
          warn: (message: string, context?: SerializableValue) => {
            this.#server.sendLoggingMessage({
              level: "warning",
              data: {
                message,
                context,
              },
            });
          },
        };

        const maybeStringResult = await tool.execute(args, {
          reportProgress,
          log,
          session: this.#auth,
        });

        if (typeof maybeStringResult === "string") {
          result = ContentResultZodSchema.parse({
            content: [{ type: "text", text: maybeStringResult }],
          });
        } else if ("type" in maybeStringResult) {
          result = ContentResultZodSchema.parse({
            content: [maybeStringResult],
          });
        } else {
          result = ContentResultZodSchema.parse(maybeStringResult);
        }
      } catch (error) {
        if (error instanceof UserError) {
          return {
            content: [{ type: "text", text: error.message }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Error: ${error}` }],
          isError: true,
        };
      }

      return result;
    });
  }

  private setupResourceHandlers(resources: Resource[]) {
    this.#server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: resources.map((resource) => {
          return {
            uri: resource.uri,
            name: resource.name,
            mimeType: resource.mimeType,
          };
        }),
      };
    });

    this.#server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        if ("uri" in request.params) {
          const resource = resources.find(
            (resource) =>
              "uri" in resource && resource.uri === request.params.uri
          );

          if (!resource) {
            for (const resourceTemplate of this.#resourceTemplates) {
              const uriTemplate = parseURITemplate(
                resourceTemplate.uriTemplate
              );

              const match = uriTemplate.fromUri(request.params.uri);

              if (!match) {
                continue;
              }

              const uri = uriTemplate.fill(match);

              const result = await resourceTemplate.load(match);

              return {
                contents: [
                  {
                    uri: uri,
                    mimeType: resourceTemplate.mimeType,
                    name: resourceTemplate.name,
                    ...result,
                  },
                ],
              };
            }

            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${request.params.uri}`
            );
          }

          if (!("uri" in resource)) {
            throw new UnexpectedStateError("Resource does not support reading");
          }

          let maybeArrayResult: Awaited<ReturnType<Resource["load"]>>;

          try {
            maybeArrayResult = await resource.load();
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Error reading resource: ${error}`,
              {
                uri: resource.uri,
              }
            );
          }

          if (Array.isArray(maybeArrayResult)) {
            return {
              contents: maybeArrayResult.map((result) => ({
                uri: resource.uri,
                mimeType: resource.mimeType,
                name: resource.name,
                ...result,
              })),
            };
          }
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType,
                name: resource.name,
                ...maybeArrayResult,
              },
            ],
          };
        }

        throw new UnexpectedStateError("Unknown resource request", {
          request,
        });
      }
    );
  }

  private setupResourceTemplateHandlers(resourceTemplates: ResourceTemplate[]) {
    this.#server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => {
        return {
          resourceTemplates: resourceTemplates.map((resourceTemplate) => {
            return {
              name: resourceTemplate.name,
              uriTemplate: resourceTemplate.uriTemplate,
            };
          }),
        };
      }
    );
  }

  private setupPromptHandlers(prompts: Prompt[]) {
    this.#server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: prompts.map((prompt) => {
          return {
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
            complete: prompt.complete,
          };
        }),
      };
    });

    this.#server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = prompts.find(
        (prompt) => prompt.name === request.params.name
      );

      if (!prompt) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown prompt: ${request.params.name}`
        );
      }

      const args = request.params.arguments;

      for (const arg of prompt.arguments ?? []) {
        if (arg.required && !(args && arg.name in args)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Missing required argument: ${arg.name}`
          );
        }
      }

      let result: Awaited<ReturnType<Prompt["load"]>>;

      try {
        result = await prompt.load(args as Record<string, string | undefined>);
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error loading prompt: ${error}`
        );
      }

      return {
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: { type: "text", text: result },
          },
        ],
      };
    });
  }
}
