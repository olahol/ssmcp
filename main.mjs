// @ts-check
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  initializeServerState,
  mcpCallTool,
  mcpListTools,
  mcpListPrompts,
  mcpGetPrompt,
  mcpListResources,
  mcpReadResource,
} from "./lib.mjs";

/**
 * Default HTTP client implementation using fetch.
 * @type {import("./lib.mjs").HttpClient}
 */
const defaultHttpClient = {
  async getUrl(url, headers) {
    const res = await fetch(url, headers ? { headers } : undefined);
    return res;
  },

  async postUrl(url, data, headers) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(data),
    });

    return res;
  },
};

/**
 * Converts an SSMCP server configuration into a full MCP Server instance.
 * @param {{baseUrl: string, headers?: Record<string, string>}} serverConfig Configuration for the SSMCP server.
 */
export const toMCPServer = async (serverConfig) => {
  const state = await initializeServerState(defaultHttpClient, serverConfig);

  const capabilities = /** @type {{[x: string]: unknown}} */ ({});
  if (state.tools) {
    capabilities["tools"] = {};
  }
  if (state.prompts) {
    capabilities["prompts"] = {};
  }
  if (state.resources) {
    capabilities["resources"] = {};
  }

  const server = new Server(
    {
      name: state.manifest.name,
      version: state.manifest.version,
    },
    { capabilities }
  );

  if (state.tools && state.toolsUrl) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // @ts-ignore
      return mcpListTools(state);
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return mcpCallTool(
        defaultHttpClient,
        // @ts-ignore
        state,
        request.params.name,
        request.params.arguments
      );
    });
  }

  if (state.prompts && state.promptsUrl) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      // @ts-ignore
      return mcpListPrompts(state);
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return mcpGetPrompt(
        defaultHttpClient,
        // @ts-ignore
        state,
        request.params.name,
        request.params.arguments
      );
    });
  }

  if (state.resources && state.resourcesUrl) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      // @ts-ignore
      return mcpListResources(state);
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return mcpReadResource(
        defaultHttpClient,
        // @ts-ignore
        state,
        request.params.uri,
        request.params.arguments || {}
      );
    });
  }

  return server;
};
