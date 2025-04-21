import { z } from "zod";
import { readFile } from "node:fs/promises";
import EventEmitter from "node:events";
import type { IncomingMessage } from "node:http";
import type { FastMCPSession } from "./session.js";
import type { Root } from "@zaptomcp/sdk/types";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { fileTypeFromBuffer } from "file-type";
import type { StrictEventEmitter } from "strict-event-emitter-types";

type SSEServer = {
  close: () => Promise<void>;
};

type FastMCPEvents<T extends FastMCPSessionAuth> = {
  connect: (event: { session: FastMCPSession<T> }) => void;
  disconnect: (event: { session: FastMCPSession<T> }) => void;
};

type FastMCPSessionEvents = {
  rootsChanged: (event: { roots: Root[] }) => void;
  error: (event: { error: Error }) => void;
};

/**
 * Generates an image content object from a URL, file path, or buffer.
 */
const imageContent = async (
  input: { url: string } | { path: string } | { buffer: Buffer }
): Promise<ImageContent> => {
  let rawData: Buffer;

  if ("url" in input) {
    const response = await fetch(input.url);

    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }

    rawData = Buffer.from(await response.arrayBuffer());
  } else if ("path" in input) {
    rawData = await readFile(input.path);
  } else if ("buffer" in input) {
    rawData = input.buffer;
  } else {
    throw new Error(
      "Invalid input: Provide a valid 'url', 'path', or 'buffer'"
    );
  }

  const mimeType = await fileTypeFromBuffer(rawData);

  const base64Data = rawData.toString("base64");

  return {
    type: "image",
    data: base64Data,
    mimeType: mimeType?.mime ?? "image/png",
  } as const;
};

type Extra = unknown;

type Extras = Record<string, Extra>;

type ToolParameters = StandardSchemaV1;

type Literal = boolean | null | number | string | undefined;

type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

type Progress = {
  /**
   * The progress thus far. This should increase every time progress is made, even if the total is unknown.
   */
  progress: number;
  /**
   * Total number of items to process (or total progress required), if known.
   */
  total?: number;
};

type Context<T extends FastMCPSessionAuth> = {
  session: T | undefined;
  reportProgress: (progress: Progress) => Promise<void>;
  log: {
    debug: (message: string, data?: SerializableValue) => void;
    error: (message: string, data?: SerializableValue) => void;
    info: (message: string, data?: SerializableValue) => void;
    warn: (message: string, data?: SerializableValue) => void;
  };
};

type TextContent = {
  type: "text";
  text: string;
};

const TextContentZodSchema = z
  .object({
    type: z.literal("text"),
    /**
     * The text content of the message.
     */
    text: z.string(),
  })
  .strict() satisfies z.ZodType<TextContent>;

type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

const ImageContentZodSchema = z
  .object({
    type: z.literal("image"),
    /**
     * The base64-encoded image data.
     */
    data: z.string().base64(),
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: z.string(),
  })
  .strict() satisfies z.ZodType<ImageContent>;

type Content = TextContent | ImageContent;

const ContentZodSchema = z.discriminatedUnion("type", [
  TextContentZodSchema,
  ImageContentZodSchema,
]) satisfies z.ZodType<Content>;

type ContentResult = {
  content: Content[];
  isError?: boolean;
};

export const ContentResultZodSchema = z
  .object({
    content: ContentZodSchema.array(),
    isError: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ContentResult>;

type Completion = {
  values: string[];
  total?: number;
  hasMore?: boolean;
};

/**
 * https://github.com/modelcontextprotocol/typescript-sdk/blob/3164da64d085ec4e022ae881329eee7b72f208d4/src/types.ts#L983-L1003
 */
export const CompletionZodSchema = z.object({
  /**
   * An array of completion values. Must not exceed 100 items.
   */
  values: z.array(z.string()).max(100),
  /**
   * The total number of completion options available. This can exceed the number of values actually sent in the response.
   */
  total: z.optional(z.number().int()),
  /**
   * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
   */
  hasMore: z.optional(z.boolean()),
}) satisfies z.ZodType<Completion>;

type Tool<
  T extends FastMCPSessionAuth,
  Params extends ToolParameters = ToolParameters
> = {
  name: string;
  description?: string;
  parameters?: Params;
  execute: (
    args: StandardSchemaV1.InferOutput<Params>,
    context: Context<T>
  ) => Promise<string | ContentResult | TextContent | ImageContent>;
};

type ResourceResult =
  | {
      text: string;
    }
  | {
      blob: string;
    };

type InputResourceTemplateArgument = Readonly<{
  name: string;
  description?: string;
  complete?: ArgumentValueCompleter;
}>;

type ResourceTemplateArgument = Readonly<{
  name: string;
  description?: string;
  complete?: ArgumentValueCompleter;
}>;

type ResourceTemplate<
  Arguments extends ResourceTemplateArgument[] = ResourceTemplateArgument[]
> = {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  arguments: Arguments;
  complete?: (name: string, value: string) => Promise<Completion>;
  load: (
    args: ResourceTemplateArgumentsToObject<Arguments>
  ) => Promise<ResourceResult>;
};

type ResourceTemplateArgumentsToObject<T extends { name: string }[]> = {
  [K in T[number]["name"]]: string;
};

type InputResourceTemplate<
  Arguments extends ResourceTemplateArgument[] = ResourceTemplateArgument[]
> = {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  arguments: Arguments;
  load: (
    args: ResourceTemplateArgumentsToObject<Arguments>
  ) => Promise<ResourceResult>;
};

type Resource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  load: () => Promise<ResourceResult | ResourceResult[]>;
  complete?: (name: string, value: string) => Promise<Completion>;
};

type ArgumentValueCompleter = (value: string) => Promise<Completion>;

type InputPromptArgument = Readonly<{
  name: string;
  description?: string;
  required?: boolean;
  complete?: ArgumentValueCompleter;
  enum?: string[];
}>;

type PromptArgumentsToObject<T extends { name: string; required?: boolean }[]> =
  {
    [K in T[number]["name"]]: Extract<
      T[number],
      { name: K }
    >["required"] extends true
      ? string
      : string | undefined;
  };

type InputPrompt<
  Arguments extends InputPromptArgument[] = InputPromptArgument[],
  Args = PromptArgumentsToObject<Arguments>
> = {
  name: string;
  description?: string;
  arguments?: InputPromptArgument[];
  load: (args: Args) => Promise<string>;
};

type PromptArgument = Readonly<{
  name: string;
  description?: string;
  required?: boolean;
  complete?: ArgumentValueCompleter;
  enum?: string[];
}>;

type Prompt<
  Arguments extends PromptArgument[] = PromptArgument[],
  Args = PromptArgumentsToObject<Arguments>
> = {
  arguments?: PromptArgument[];
  complete?: (name: string, value: string) => Promise<Completion>;
  description?: string;
  load: (args: Args) => Promise<string>;
  name: string;
};

type ServerOptions<T extends FastMCPSessionAuth> = {
  name: string;
  version: `${number}.${number}.${number}`;
  authenticate?: Authenticate<T>;
};

type LoggingLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

const FastMCPSessionEventEmitterBase: {
  new (): StrictEventEmitter<EventEmitter, FastMCPSessionEvents>;
} = EventEmitter;

class FastMCPSessionEventEmitter extends FastMCPSessionEventEmitterBase {}

type SamplingResponse = {
  model: string;
  stopReason?: "endTurn" | "stopSequence" | "maxTokens" | string;
  role: "user" | "assistant";
  content: Content;
};

type FastMCPSessionAuth = Record<string, unknown> | undefined;

const FastMCPEventEmitterBase: {
  new (): StrictEventEmitter<EventEmitter, FastMCPEvents<FastMCPSessionAuth>>;
} = EventEmitter;

class FastMCPEventEmitter extends FastMCPEventEmitterBase {}

type Authenticate<T> = (request: IncomingMessage) => Promise<T>;

// Export all types at the bottom
export type {
  SSEServer,
  FastMCPEvents,
  FastMCPSessionEvents,
  Extra,
  Extras,
  ToolParameters,
  Literal,
  SerializableValue,
  Progress,
  Context,
  TextContent,
  ImageContent,
  Content,
  ContentResult,
  Completion,
  Tool,
  ResourceResult,
  InputResourceTemplateArgument,
  ResourceTemplateArgument,
  ResourceTemplate,
  ResourceTemplateArgumentsToObject,
  InputResourceTemplate,
  Resource,
  ArgumentValueCompleter,
  InputPromptArgument,
  PromptArgumentsToObject,
  InputPrompt,
  PromptArgument,
  Prompt,
  ServerOptions,
  LoggingLevel,
  SamplingResponse,
  FastMCPSessionAuth,
  Authenticate,
};

// Export functions and classes
export { imageContent };
export { FastMCPSessionEventEmitter };
export { FastMCPEventEmitter };
