# Simple Stateless Model Context Protocol

🚧 **WORK IN PROGRESS, ONLY TOOLS, RESOURCES AND PROMPTS SUPPORTED** 🚧

SSMCP is a stateless model context protocol that is designed to be easy to
understand and implement for web developers. It is built on top of HTTP
and tries to follow common HTTP conventions like REST and HATEOAS. All
SSMCP servers can be used as MCP servers through an adapter script
`npx ssmcp --url http://127.0.0.1/`.

## Why?

Because most MCP servers do not use nor require the stateful features
of the protocol and by removing them the complexity can be drastically
reduced.

## Overview

SSMCP services are discovered by a `GET` request to the root
URL. Thereafter the root URL is used as a base to derive other URLs.

### `GET /`

Returns the server manifest which contains information and
capabilities. Analogous to `InitializeResult` in the MCP Specification.

**Response Body**

```json
{
  "name": "calculator",
  "version": "1.0.0",
  "tools": true
}
```

### `GET /tools`

Lists tools provided by the server. Analogous to `ListToolsResult`
in the MCP Specification. Unlike MCP there is no pagination.

**Response Body**

```json
[
  {
    "name": "add",
    "description": "Add two numbers",
    "inputSchema": {
      "type": "object",
      "properties": {
        "a": {
          "type": "number"
        },
        "b": {
          "type": "number"
        }
      },
      "required": ["a", "b"]
    }
  }
]
```

### `POST /tools/:name`

Tool call, the URL parameter `name` corresponds to the tool name listed
in `GET /tools` and the json body matches the `inputSchema` JSON Schema.

**Request Body**

```json
{
  "a": 13,
  "b": 29
}
```

The `Content-Type` of the response matters because the `ssmcp` adapter
uses it to control how the content is converted to MCP content. For
example `text/plain` is converted to `TextContent`.

**Response**

```http
HTTP/1.1 200 Ok
Content-Type: text/plain

42
```
