// @ts-check
/**
 * @typedef {{ name: string; description: string; inputSchema: object; }} MCPTool
 */

/**
 * @typedef {{ name: string; description: string; required?: boolean; }} MCPPromptArgument
 */

/**
 * @typedef {{ name: string; description: string; arguments?: MCPPromptArgument[]; }} MCPPrompt
 */

/**
 * @typedef {{ uri: string; name: string; description?: string; mimeType?: string; }} MCPResource
 */

/**
 * @typedef {{ uriTemplate: string; name: string; description?: string; mimeType?: string; }} MCPResourceTemplate
 */

/**
 * @typedef {MCPPrompt & { href?: string; }} SSMCPPrompt
 */

/**
 * @typedef {MCPResource & { href?: string; }} SSMCPResource
 */

/**
 * @typedef {MCPResourceTemplate & { href?: string; }} SSMCPResourceTemplate
 */

/**
 * @typedef {{
 *   type: "text"; text: string;
 * } | {
 *   type: "image"; mimeType: string; data: string;
 * }} MCPContent
 */

/**
 * @typedef {{
 *   role: "user" | "assistant"
 *   content: MCPContent;
 * }} MCPPromptMessage
 */

/**
 * @typedef {{ description?: string; messages: MCPPromptMessage[]; }} MCPGetPromptResult
 */

/**
 * @typedef {{
 *   uri: string;
 *   mimeType?: string;
 *   text?: string;
 *   blob?: string;
 * }} MCPResourceContent
 */

/**
 * @typedef {{ contents: MCPResourceContent[]; }} MCPReadResourceResult
 */

/**
 * @typedef {{
 *   name: string;
 *   version: string;
 *   tools?: string | boolean;
 *   prompts?: string | boolean;
 *   resources?: string | boolean;
 *   resourceTemplates?: string | boolean;
 * }} SSMCPManifest
 */

/**
 * @typedef {MCPTool & { href?: string }} SSMCPTool
 */

/**
 * @typedef {{
 *   getUrl: (url: string, headers?: Record<string, string>) => Promise<Response>;
 *   postUrl: (url: string, data: any, headers?: Record<string, string>) => Promise<Response>;
 * }} HttpClient
 */

/**
 * @typedef {{
 *  baseUrl: string;
 *  headers?: Record<string, string>;
 *  manifest: SSMCPManifest;
 *  tools?: SSMCPTool[];
 *  toolsUrl?: string;
 *  prompts?: SSMCPPrompt[];
 *  promptsUrl?: string;
 *  resources?: SSMCPResource[];
 *  resourcesUrl?: string;
 *  resourceTemplates?: SSMCPResourceTemplate[];
 *  resourceTemplatesUrl?: string;
 * }} ServerState
 */

/**
 * Combines a base URL with a relative URL, ensuring proper handling of slashes.
 * @param {string} baseURL The base URL.
 * @param {string} relativeURL The relative URL to append.
 * @returns {string} The combined URL.
 */
const combineURLs = (baseURL, relativeURL) =>
  relativeURL
    ? baseURL.replace(/\/+$/, "") + "/" + relativeURL.replace(/^\/+/, "")
    : baseURL;

/**
 * Helper to create a standard text content object.
 * @param {string} text The text for the content.
 * @returns {{ content: { type: "text"; text: string; }[] }} The text content object.
 */
const makeTextContent = (text) => ({ content: [{ type: "text", text }] });

/**
 * Handles common HTTP errors by throwing appropriate errors.
 * @param {Response} res The HTTP response object.
 * @throws {Error} If response status is 401 or 403.
 */
const handleHttpError = (res) => {
  if (res.status === 401) throw new Error("Unauthorized");
  if (res.status === 403) throw new Error("Forbidden");
};

/**
 * Checks if content type represents text-based content.
 * @param {string} contentType The content type to check.
 * @returns {boolean} True if content type is text-based.
 */
const isTextContent = (contentType) =>
  contentType.includes("text/") ||
  contentType.includes("application/json") ||
  contentType.includes("application/xml");

export const toMCPContent = async (res) => {
  const contentType = res.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/plain")) {
    return makeTextContent(await res.text());
  }

  if (contentType.includes("application/json")) {
    const json = await res.json();

    if (Array.isArray(json)) {
      return { content: json };
    }

    if (typeof json === "object" && json !== null) {
      return json;
    }

    return makeTextContent(
      typeof json === "string" ? json : JSON.stringify(json)
    );
  }

  if (contentType.startsWith("image/")) {
    const arrayBuffer = await res.arrayBuffer();
    return {
      content: [
        {
          type: "image",
          mimeType: contentType,
          data: Buffer.from(arrayBuffer).toString("base64"),
        },
      ],
    };
  }

  throw new Error(`Unsupported or unknown content type "${contentType}".`);
};

export const toMCPResourceContent = async (res, uri) => {
  const contentType = res.headers.get("Content-Type") ?? "";

  if (isTextContent(contentType)) {
    return { uri, mimeType: contentType, text: await res.text() };
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    uri,
    mimeType: contentType || "application/octet-stream",
    blob: Buffer.from(arrayBuffer).toString("base64"),
  };
};

/**
 * Fetches a specific manifest section (tools, prompts, resources, or resourceTemplates).
 * @param {HttpClient} httpClient The HTTP client.
 * @param {string} baseUrl The base URL.
 * @param {Record<string, string> | undefined} headers Optional headers.
 * @param {string} sectionName The name of the section to fetch.
 * @param {string | boolean} manifestValue The manifest value for this section.
 * @returns {Promise<Record<string, any>>} Object containing the section data and URL.
 * @throws {Error} If the HTTP request fails.
 */
const fetchManifestSection = async (
  httpClient,
  baseUrl,
  headers,
  sectionName,
  manifestValue
) => {
  if (!manifestValue) return {};

  const path =
    typeof manifestValue === "string"
      ? manifestValue
      : sectionName === "resourceTemplates"
      ? "resource_templates"
      : sectionName;
  const url = combineURLs(baseUrl, path);

  const res = await httpClient.getUrl(url, headers);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${sectionName}: ${res.status} ${res.statusText}`
    );
  }

  return {
    [sectionName]: await res.json(),
    [`${sectionName}Url`]: url,
  };
};

/**
 * Initializes the server state by fetching the manifest and, if applicable, tool and prompt definitions.
 * @param {HttpClient} httpClient The HTTP client.
 * @param {{baseUrl: string, headers?: Record<string, string>}} config The server configuration.
 * @returns {Promise<ServerState>} The initialized server state.
 * @throws {Error} If fetching manifest, tools, or prompts fails.
 */
export const initializeServerState = async (httpClient, config) => {
  const { baseUrl, headers } = config;
  const manifestRes = await httpClient.getUrl(baseUrl, headers);

  if (!manifestRes.ok) {
    throw new Error(
      `Failed to fetch manifest: ${manifestRes.status} ${manifestRes.statusText}`
    );
  }

  const manifest = await manifestRes.json();

  const sections = await Promise.all([
    fetchManifestSection(httpClient, baseUrl, headers, "tools", manifest.tools),
    fetchManifestSection(
      httpClient,
      baseUrl,
      headers,
      "prompts",
      manifest.prompts
    ),
    fetchManifestSection(
      httpClient,
      baseUrl,
      headers,
      "resources",
      manifest.resources
    ),
    fetchManifestSection(
      httpClient,
      baseUrl,
      headers,
      "resourceTemplates",
      manifest.resourceTemplates
    ),
  ]);

  return { config, manifest, ...Object.assign({}, ...sections) };
};

/**
 * Lists the available tools based on the initialized server state.
 * @param {{tools: SSMCPTool[]}} state The initialized server state.
 * @returns {Promise<{ tools: MCPTool[] }>} Object containing the list of tools.
 */
export const mcpListTools = async (state) => ({
  tools: state.tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
});

/**
 * Lists the available prompts based on the initialized server state.
 * @param {{prompts: SSMCPPrompt[]}} state The initialized server state.
 * @returns {Promise<{ prompts: MCPPrompt[] }>} Object containing the list of prompts.
 */
export const mcpListPrompts = async (state) => ({
  prompts: state.prompts.map(({ name, description, arguments: args }) => ({
    name,
    description,
    arguments: args,
  })),
});

/**
 * Lists the available resources based on the initialized server state.
 * @param {{resources: SSMCPResource[]}} state The initialized server state.
 * @returns {Promise<{ resources: MCPResource[] }>} Object containing the list of resources.
 */
export const mcpListResources = async (state) => ({
  resources: state.resources.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  })),
});

/**
 * Lists the available resource templates based on the initialized server state.
 * @param {{resourceTemplates: SSMCPResourceTemplate[]}} state The initialized server state.
 * @returns {Promise<{ resourceTemplates: MCPResourceTemplate[] }>} Object containing the list of resource templates.
 */
export const mcpListResourceTemplates = async (state) => ({
  resourceTemplates: state.resourceTemplates.map(
    ({ uriTemplate, name, description, mimeType }) => ({
      uriTemplate,
      name,
      description,
      mimeType,
    })
  ),
});

/**
 * Calls a specific tool using the initialized server state.
 * @param {HttpClient} httpClient The HTTP Client.
 * @param {{baseUrl: string, headers?: Record<string, string>, toolsUrl: string, tools: SSMCPTool[]}} state The initialized server state.
 * @param {string} toolName The name of the tool to call.
 * @param {object} toolArguments The arguments for the tool.
 * @returns {Promise<any>} The tool response content.
 * @throws {Error} If tools are not available, tool is not found, or an HTTP/conversion error occurs.
 */
export const mcpCallTool = async (
  httpClient,
  state,
  toolName,
  toolArguments
) => {
  const tool = state.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool "${toolName}"`);

  const toolPath = tool.href ?? tool.name;
  const resolvedToolUrl = combineURLs(state.toolsUrl, toolPath);
  const res = await httpClient.postUrl(
    resolvedToolUrl,
    toolArguments,
    state.headers
  );

  handleHttpError(res);

  const content = await toMCPContent(res);
  if (!res.ok) content.isError = true;
  return content;
};

/**
 * Gets a specific prompt using the initialized server state.
 * @param {HttpClient} httpClient The HTTP Client.
 * @param {{baseUrl: string, headers?: Record<string, string>, promptsUrl: string, prompts: SSMCPPrompt[]}} state The initialized server state.
 * @param {string} promptName The name of the prompt to get.
 * @param {any} promptArguments The arguments for the prompt.
 * @returns {Promise<MCPGetPromptResult>} The prompt response.
 * @throws {Error} If prompts are not available, prompt is not found, or an HTTP/conversion error occurs.
 */
export const mcpGetPrompt = async (
  httpClient,
  state,
  promptName,
  promptArguments
) => {
  const prompt = state.prompts.find((p) => p.name === promptName);
  if (!prompt) throw new Error(`Unknown prompt "${promptName}"`);

  const promptPath = prompt.href ?? prompt.name;
  const basePromptUrl = combineURLs(state.promptsUrl, promptPath);

  const queryParams = new URLSearchParams();
  if (promptArguments && typeof promptArguments === "object") {
    Object.entries(promptArguments).forEach(([key, value]) =>
      queryParams.append(key, String(value))
    );
  }

  const resolvedPromptUrl = queryParams.toString()
    ? `${basePromptUrl}?${queryParams}`
    : basePromptUrl;
  const res = await httpClient.getUrl(resolvedPromptUrl, state.headers);

  handleHttpError(res);
  if (!res.ok) {
    throw new Error(
      `Failed to get prompt "${promptName}": ${res.status} ${res.statusText}`
    );
  }

  const contentType = res.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await res.json();
    if (json && typeof json === "object" && Array.isArray(json.messages))
      return json;
    return {
      messages: [
        {
          role: "assistant",
          content: { type: "text", text: JSON.stringify(json) },
        },
      ],
    };
  }

  if (contentType.includes("text/plain")) {
    return {
      messages: [
        { role: "user", content: { type: "text", text: await res.text() } },
      ],
    };
  }

  throw new Error(
    `Unsupported content type "${contentType}" for prompt response.`
  );
};

/**
 * Reads a specific resource using the initialized server state.
 * @param {HttpClient} httpClient The HTTP Client.
 * @param {{baseUrl: string, headers?: Record<string, string>, resourcesUrl: string, resources: SSMCPResource[]}} state The initialized server state.
 * @param {string} resourceUri The URI of the resource to read.
 * @param {object} [resourceArguments={}] The arguments for the resource.
 * @returns {Promise<MCPReadResourceResult>} The resource content.
 * @throws {Error} If resources are not available, resource is not found, or an HTTP/conversion error occurs.
 */
export const mcpReadResource = async (
  httpClient,
  state,
  resourceUri,
  resourceArguments = {}
) => {
  const resource = state.resources.find((r) => r.uri === resourceUri);
  if (!resource) throw new Error(`Unknown resource "${resourceUri}"`);

  const queryParams = new URLSearchParams({
    uri: resourceUri,
    ...resourceArguments,
  });
  const resolvedResourceUrl = resource.href
    ? `${combineURLs(state.resourcesUrl, resource.href)}?${queryParams}`
    : `${state.resourcesUrl}?${queryParams}`;

  const res = await httpClient.getUrl(resolvedResourceUrl, state.headers);

  handleHttpError(res);

  if (!res.ok) {
    throw new Error(
      `Failed to read resource "${resourceUri}": ${res.status} ${res.statusText}`
    );
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await res.json();
    if (json && typeof json === "object" && Array.isArray(json.contents))
      return json;
  }

  const content = await toMCPResourceContent(res, resourceUri);
  return { contents: [content] };
};
