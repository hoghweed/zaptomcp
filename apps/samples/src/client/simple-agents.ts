import { ChatOllama } from "@langchain/ollama";
import { RunnableSequence } from "@langchain/core/runnables";
import { AgentExecutor, ChatAgentOutputParser } from "langchain/agents";
import { formatToOpenAIFunctionMessages } from "langchain/agents/format_scratchpad";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { OpenAIFunctionsAgentOutputParser } from "langchain/agents/openai/output_parser";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import type { AgentStep } from "@langchain/core/agents";
import { MultiServerMCPClient } from "./mcp/mcp-session.js";
import { load_mcp_tools } from "./mcp/mcp-tools.js";

// interact with the model
const model = new ChatOllama({ model: "llama3:latest", temperature: 0 });

// define the prompt
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are very powerful assistant, but don't know current events"],
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

const mcpServerConfigs = {
  weather: {
    url: "http://localhost:3000/mcp",
    transport: "streamable-http",
  },
};

const client = new MultiServerMCPClient(mcpServerConfigs);
await client.initialize();

const tools = await load_mcp_tools(client);

model.bindTools(Object.values(tools));

// define the runnable agent
const runnableAgent = RunnableSequence.from([
  {
    input: (i: { input: string; steps: AgentStep[] }) => i.input,
    agent_scratchpad: (i: { input: string; steps: AgentStep[] }) =>
      formatToOpenAIFunctionMessages(i.steps),
  },
  prompt,
  model,
  new ChatAgentOutputParser()
]);

// define the executor
const executor = AgentExecutor.fromAgentAndTools({
  agent: runnableAgent,
  tools: Object.values(tools),
});

console.log("Loaded agent executor");

const input = "How many letters in the word educa?";
console.log(`Calling agent executor with query: ${input}`);
const result = await executor.invoke({
  input,
});
console.log(result);
