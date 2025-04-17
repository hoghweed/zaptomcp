# ⚠️ Work in Progress

> **Warning**: This repository is currently under active development. The API and implementation details are subject to change. Use at your own risk.

[![GitHub package.json version](https://img.shields.io/github/package-json/v/hoghweed/zaptomcp)](https://github.com/hoghweed/zaptomcp/releases) ![node:20](https://img.shields.io/badge/node-20-lightgreen) ![pnpm@10.8.1](https://img.shields.io/badge/pnpm-10.8.1-yellow) [![npm](https://img.shields.io/npm/dt/@zaptomcp/sdk)](https://www.npmjs.com/package/@zaptomcp/sdk) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/) [![Biome](https://img.shields.io/badge/Biome-1.9.4-ff69b4.svg)](https://biomejs.dev/)

# ZapToMCP

<p align="center">
 <img align="center" alt="Valkeyrie" height="200" src="assets/logo.png">
</p>

ZapToMCP is a monorepo containing tools and libraries for building Model Context Protocol (MCP) servers and clients. It provides a streamlined way to create, deploy, and manage MCP-compatible services.

## Overview

The Model Context Protocol (MCP) is an open standard for communication between AI assistants and tools. ZapToMCP simplifies the process of building MCP-compatible servers and clients, allowing developers to focus on creating powerful AI experiences rather than implementing protocol details.

## Repository Structure
This monorepo contains the following packages:

- `@zaptomcp/sdk` : A TypeScript implementation of the Model Context Protocol
- `@zaptomcp/server` : A higher-level abstraction for creating MCP servers
- More packages coming soon...


## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 10.8.1

### Installation
Clone the repository:

```bash
git clone https://github.com/hoghweed/zaptomcp.git
cd zaptomcp
 ```

Install dependencies:

```bash
pnpm install
 ```

### Installation

```bash
# Install dependencies
pnpm install

# Bootstrap the monorepo
pnpm bootstrap
```

## Development

### Available Scripts

- `pnpm dev`: Start development mode for all packages
- `pnpm build`: Build all packages
- `pnpm clean`: Clean build artifacts
- `pnpm lint`: Run linting across all packages
- `pnpm format`: Format code across all packages
- `pnpm typecheck`: Run type checking across all packages
- `pnpm commit`: Create a commit using conventional commit format

### Code Quality

This project uses:
- Biome for linting and formatting
- TypeScript for type checking
- Husky for git hooks
- Commitlint for commit message validation

## @zaptomcp/sdk

The SDK package provides a TypeScript implementation for interacting with the Model Context Protocol (MCP).

### Features

- Multiple transport implementations:
  - In-memory
  - SSE (Server-Sent Events)
  - Stdio
  - Streamable HTTP
- Type-safe API
- Built with Fastify for high performance
- Support for both ESM and CommonJS

### Installation

```bash
pnpm add @zaptomcp/sdk
```

### Usage

Usage Creating an MCP Server

```typescript
import { McpServer } from '@zaptomcp/sdk';

// Create a server with basic information
const server = new McpServer(
  {
    name: "my-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      // Define your server capabilities
      sampling: {},
      prompts: {},
      resources: {},
      tools: {},
      logging: {}
    },
    instructions: "This is an MCP-compatible server"
  }
);

// Connect the server to a transport
import { FastifyTransport } from '@zaptomcp/sdk/transports';
const transport = new FastifyTransport();
await server.connect(transport);

// Start listening for requests
await transport.listen(3000);
console.log("MCP server running on port 3000");
 ```

Creating an MCP Client

```typescript
import { Client } from '@zaptomcp/sdk';

// Create a client with basic information
const client = new Client(
  {
    name: "my-mcp-client",
    version: "1.0.0"
  },
  {
    capabilities: {
      // Define your client capabilities
      sampling: {}
    }
  }
);

// Connect to an MCP server
import { HTTPClientTransport } from '@zaptomcp/sdk/transports';
const transport = new HTTPClientTransport('http://localhost:3000');
await client.connect(transport);

// Read a resource
const resource = await client.readResource({
  uri: "test://example/resource"
});

console.log(resource);
 ```

### API Documentation

The SDK provides the following main exports:

- `Server`: The main server class
- `transports`: Various transport implementations
  - `in-memory`: In-memory transport
  - `sse`: Server-Sent Events transport
  - `stdio`: Standard I/O transport
  - `streamable-http`: HTTP transport with streaming support

### Development

To work on the SDK:

```bash
# Navigate to the SDK package
cd packages/sdk

# Install dependencies
pnpm install

# Start development mode
pnpm dev

# Run tests
pnpm test

# Build the package
pnpm build
```

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch ( git checkout -b feature/amazing-feature )
3. Commit your changes using conventional commits ( pnpm commit )
4. Push to the branch ( git push origin feature/amazing-feature )
5. Open a Pull Request
## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- ZapToMCP is an inspired porting of [FastMCP](https://github.com/punkpeye/fastmcp)
- Model Context Protocol [Typescript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - The open standard this project implements
- FastMCP is inspired by the [Python implementation](https://github.com/jlowin/fastmcp) by [Jonathan Lowin](https://github.com/jlowin).
- Parts of codebase were adopted from [LiteMCP](https://github.com/wong2/litemcp).
- Parts of codebase were adopted from [Model Context protocolでSSEをやってみる](https://dev.classmethod.jp/articles/mcp-sse/).