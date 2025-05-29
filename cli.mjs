#!/usr/bin/env node

// @ts-check

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toMCPServer } from "./main.mjs";

const BIN_NAME = "ssmcp";

/** @param {string | undefined} errorMessage Error message to print. */
const printUsageAndExit = (errorMessage) => {
  if (errorMessage) {
    console.error(`Error: ${errorMessage}`);
  }

  console.error(
    `Usage: ${BIN_NAME} --url <host_url> [-H "HeaderName: HeaderValue" | --header "HeaderName: HeaderValue"] [-a <token> | --auth <token>] ...`
  );
  console.error(
    `Example: ${BIN_NAME} --url http://localhost:8080 -H "Authorization: Bearer token" -H "X-Custom-Header: value"`
  );
  console.error(
    `         ${BIN_NAME} --url http://localhost:8080 -a "your_bearer_token"`
  );
  console.error(
    `         ${BIN_NAME} --url http://localhost:8080 --auth "your_bearer_token"`
  );
  process.exit(1);
};

/**
 * Parses command-line arguments to extract the host URL and custom headers.
 * @param {string[]} argv Arguments.
 * @returns {{ url: string, customHeaders: Record<string, string> }} The parsed host and custom headers.
 */
const parseArguments = (argv) => {
  /** @type {string | undefined} */
  let url;
  /** @type {Record<string, string>} */
  const customHeaders = {};

  const args = argv.slice(2);

  while (args.length > 0) {
    const arg = args.shift();
    switch (arg) {
      case "--url":
        if (args.length > 0) {
          url = args.shift();
        } else {
          throw new Error("--url requires a value.");
        }
        break;
      case "-H":
      case "--header":
        if (args.length > 0) {
          const headerArg = args.shift();
          const parts = headerArg?.split(/:\s*/, 2);
          if (parts && parts.length === 2 && parts[0] && parts[1]) {
            customHeaders[parts[0].trim()] = parts[1].trim();
          } else {
            throw new Error(
              `Invalid header format: "${headerArg}". Expected "HeaderName: HeaderValue".`
            );
          }
        } else {
          throw new Error("-H/--header requires a value.");
        }
        break;
      case "-a":
      case "--auth":
        if (args.length > 0) {
          const token = args.shift();
          if (token) {
            customHeaders["Authorization"] = `Bearer ${token}`;
          } else {
            throw new Error(`${arg} requires a token value.`);
          }
        } else {
          throw new Error(`${arg} requires a token value.`);
        }
        break;
      default:
        throw new Error(`Unknown argument ${arg}`);
    }
  }

  if (!url) {
    throw new Error("Host URL must be provided via --url.");
  }

  return { url, customHeaders };
};

/**
 * Starts the HTTP to MCP server.
 * @param {string} url The host URL.
 * @param {Record<string, string>} customHeaders The custom headers.
 */
const startServer = async (url, customHeaders) => {
  const server = await toMCPServer({
    baseUrl: url,
    headers: customHeaders,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

try {
  const { url, customHeaders } = parseArguments(process.argv);
  startServer(url, customHeaders);
} catch (e) {
  printUsageAndExit(e instanceof Error ? e.message : String(e));
}
