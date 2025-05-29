import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  toMCPContent,
  initializeServerState,
  mcpListTools,
  mcpCallTool,
  mcpListPrompts,
  mcpGetPrompt,
  mcpListResources,
  mcpReadResource,
  mcpListResourceTemplates,
} from "./lib.mjs";

const createMockResponse = (
  contentType,
  body,
  status = 200,
  statusText = ""
) => {
  const headers = new Map(contentType ? [["Content-Type", contentType]] : []);
  const mock = {
    headers,
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => {
      if (contentType === "application/json") {
        return JSON.stringify(body);
      }
      return String(body);
    },
    json: async () => {
      if (contentType === "application/json") {
        return body;
      }
      throw new Error("Response is not JSON");
    },
    arrayBuffer: async () => {
      const data =
        contentType === "application/json"
          ? JSON.stringify(body)
          : String(body);
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
      }
      return buffer.buffer;
    },
  };

  return mock;
};

const createMockHttpClient = (responses = {}) => {
  return {
    getUrl: async (url, headers) => {
      if (responses.getUrl) {
        const pathname = new URL(url).pathname;
        for (const [pattern, response] of Object.entries(responses.getUrl)) {
          const patternPathname = new URL(pattern, "http://localhost").pathname;
          if (pathname === patternPathname || pattern === url) {
            if (response.error) throw response.error;
            return createMockResponse(
              response.contentType ?? "application/json",
              response.data,
              response.status,
              response.statusText
            );
          }
        }
      }
      throw new Error(`Unexpected GET request to ${url}`);
    },

    postUrl: async (url, data, headers) => {
      if (responses.postUrl) {
        const pathname = new URL(url).pathname;
        for (const [pattern, responseConfig] of Object.entries(
          responses.postUrl
        )) {
          const patternPathname = new URL(pattern, "http://localhost").pathname;
          if (pathname === patternPathname || pattern === url) {
            if (responseConfig.error) throw responseConfig.error;
            return createMockResponse(
              responseConfig.contentType,
              responseConfig.body,
              responseConfig.status,
              responseConfig.statusText
            );
          }
        }
      }
      throw new Error(`Unexpected POST request to ${url}`);
    },
  };
};

describe("toMCPContent", () => {
  const testCases = [
    {
      contentType: "text/plain",
      body: "Hello, world!",
      expected: { content: [{ type: "text", text: "Hello, world!" }] },
    },
    {
      contentType: "application/json",
      body: [
        { type: "text", text: "item 1" },
        { type: "text", text: "item 2" },
      ],
      expected: {
        content: [
          { type: "text", text: "item 1" },
          { type: "text", text: "item 2" },
        ],
      },
    },
    {
      contentType: "application/json",
      body: {
        content: [{ type: "text", text: "data" }],
        tool_name: "testTool",
      },
      expected: {
        content: [{ type: "text", text: "data" }],
        tool_name: "testTool",
      },
    },
    {
      contentType: "application/json",
      body: "just a string",
      expected: { content: [{ type: "text", text: "just a string" }] },
    },
    {
      contentType: "application/json",
      body: 123,
      expected: { content: [{ type: "text", text: "123" }] },
    },
    {
      contentType: "application/json",
      body: true,
      expected: { content: [{ type: "text", text: "true" }] },
    },
    {
      contentType: "image/png",
      body: "fakeImageData",
      expected: {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: btoa("fakeImageData"),
          },
        ],
      },
    },
  ];

  testCases.forEach(({ contentType, body, expected }) => {
    test(`toMCPContent with ${contentType}`, async () => {
      const result = await toMCPContent(createMockResponse(contentType, body));
      assert.deepStrictEqual(result, expected);
    });
  });

  test("toMCPContent with unknown content type", async () =>
    await assert.rejects(
      toMCPContent(createMockResponse("application/xml")),
      Error
    ));

  test("toMCPContent with no content type", async () =>
    await assert.rejects(toMCPContent(createMockResponse(null)), Error));
});

describe("initializeServerState", () => {
  const baseUrl = "http://localhost:3000";
  const headers = { Authorization: "Bearer test" };
  const mockManifest = { name: "TestServer", version: "1.0" };
  const mockTools = [
    { name: "tool1", description: "Test tool 1", inputSchema: {} },
  ];
  const mockPrompts = [{ name: "prompt1", description: "Test prompt 1" }];
  const mockResources = [
    { uri: "file://test.txt", name: "test.txt", description: "Test file" },
  ];
  const mockResourceTemplates = [
    {
      uriTemplate: "file://{path}",
      name: "fileTemplate",
      description: "File template",
    },
  ];

  test("should initialize with manifest and tools (string path)", async () => {
    const manifestWithToolsPath = { ...mockManifest, tools: "custom-tools" };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithToolsPath },
        [`${baseUrl}/custom-tools`]: { data: mockTools },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithToolsPath);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/custom-tools`);
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest and tools (boolean true)", async () => {
    const manifestWithToolsBool = { ...mockManifest, tools: true };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithToolsBool },
        [`${baseUrl}/tools`]: { data: mockTools },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithToolsBool);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/tools`);
  });

  test("should initialize with manifest, tools, and prompts (string paths)", async () => {
    const manifestWithPaths = {
      ...mockManifest,
      tools: "custom-tools",
      prompts: "custom-prompts",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithPaths },
        [`${baseUrl}/custom-tools`]: { data: mockTools },
        [`${baseUrl}/custom-prompts`]: { data: mockPrompts },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithPaths);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/custom-tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/custom-prompts`);
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest, tools, and prompts (boolean true)", async () => {
    const manifestWithBooleans = {
      ...mockManifest,
      tools: true,
      prompts: true,
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithBooleans },
        [`${baseUrl}/tools`]: { data: mockTools },
        [`${baseUrl}/prompts`]: { data: mockPrompts },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithBooleans);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/prompts`);
  });

  test("should initialize with manifest only (no tools)", async () => {
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: mockManifest },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, mockManifest);
    assert.strictEqual(state.tools, undefined);
    assert.strictEqual(state.toolsUrl, undefined);
  });

  test("should initialize with manifest and resources (string path)", async () => {
    const manifestWithResourcesPath = {
      ...mockManifest,
      resources: "custom-resources",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResourcesPath },
        [`${baseUrl}/custom-resources`]: { data: mockResources },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithResourcesPath);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/custom-resources`);
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest and resources (boolean true)", async () => {
    const manifestWithResourcesBool = { ...mockManifest, resources: true };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResourcesBool },
        [`${baseUrl}/resources`]: { data: mockResources },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithResourcesBool);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/resources`);
  });

  test("should initialize with manifest, tools, prompts, and resources (string paths)", async () => {
    const manifestWithAll = {
      ...mockManifest,
      tools: "custom-tools",
      prompts: "custom-prompts",
      resources: "custom-resources",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithAll },
        [`${baseUrl}/custom-tools`]: { data: mockTools },
        [`${baseUrl}/custom-prompts`]: { data: mockPrompts },
        [`${baseUrl}/custom-resources`]: { data: mockResources },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithAll);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/custom-tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/custom-prompts`);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/custom-resources`);
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest, tools, prompts, and resources (boolean true)", async () => {
    const manifestWithAllBool = {
      ...mockManifest,
      tools: true,
      prompts: true,
      resources: true,
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithAllBool },
        [`${baseUrl}/tools`]: { data: mockTools },
        [`${baseUrl}/prompts`]: { data: mockPrompts },
        [`${baseUrl}/resources`]: { data: mockResources },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithAllBool);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/prompts`);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/resources`);
  });

  test("should initialize with manifest and resource templates (string path)", async () => {
    const manifestWithResourceTemplatesPath = {
      ...mockManifest,
      resourceTemplates: "custom-resource-templates",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResourceTemplatesPath },
        [`${baseUrl}/custom-resource-templates`]: {
          data: mockResourceTemplates,
        },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithResourceTemplatesPath);
    assert.deepStrictEqual(state.resourceTemplates, mockResourceTemplates);
    assert.strictEqual(
      state.resourceTemplatesUrl,
      `${baseUrl}/custom-resource-templates`
    );
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest and resource templates (boolean true)", async () => {
    const manifestWithResourceTemplatesBool = {
      ...mockManifest,
      resourceTemplates: true,
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResourceTemplatesBool },
        [`${baseUrl}/resource_templates`]: { data: mockResourceTemplates },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithResourceTemplatesBool);
    assert.deepStrictEqual(state.resourceTemplates, mockResourceTemplates);
    assert.strictEqual(
      state.resourceTemplatesUrl,
      `${baseUrl}/resource_templates`
    );
  });

  test("should initialize with manifest, tools, prompts, resources, and resource templates (string paths)", async () => {
    const manifestWithAll = {
      ...mockManifest,
      tools: "custom-tools",
      prompts: "custom-prompts",
      resources: "custom-resources",
      resourceTemplates: "custom-resource-templates",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithAll },
        [`${baseUrl}/custom-tools`]: { data: mockTools },
        [`${baseUrl}/custom-prompts`]: { data: mockPrompts },
        [`${baseUrl}/custom-resources`]: { data: mockResources },
        [`${baseUrl}/custom-resource-templates`]: {
          data: mockResourceTemplates,
        },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl, headers });
    assert.deepStrictEqual(state.manifest, manifestWithAll);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/custom-tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/custom-prompts`);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/custom-resources`);
    assert.deepStrictEqual(state.resourceTemplates, mockResourceTemplates);
    assert.strictEqual(
      state.resourceTemplatesUrl,
      `${baseUrl}/custom-resource-templates`
    );
    assert.deepStrictEqual(state.config, { baseUrl, headers });
  });

  test("should initialize with manifest, tools, prompts, resources, and resource templates (boolean true)", async () => {
    const manifestWithAllBool = {
      ...mockManifest,
      tools: true,
      prompts: true,
      resources: true,
      resourceTemplates: true,
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithAllBool },
        [`${baseUrl}/tools`]: { data: mockTools },
        [`${baseUrl}/prompts`]: { data: mockPrompts },
        [`${baseUrl}/resources`]: { data: mockResources },
        [`${baseUrl}/resource_templates`]: { data: mockResourceTemplates },
      },
    });
    const state = await initializeServerState(httpClient, { baseUrl });
    assert.deepStrictEqual(state.manifest, manifestWithAllBool);
    assert.deepStrictEqual(state.tools, mockTools);
    assert.strictEqual(state.toolsUrl, `${baseUrl}/tools`);
    assert.deepStrictEqual(state.prompts, mockPrompts);
    assert.strictEqual(state.promptsUrl, `${baseUrl}/prompts`);
    assert.deepStrictEqual(state.resources, mockResources);
    assert.strictEqual(state.resourcesUrl, `${baseUrl}/resources`);
    assert.deepStrictEqual(state.resourceTemplates, mockResourceTemplates);
    assert.strictEqual(
      state.resourceTemplatesUrl,
      `${baseUrl}/resource_templates`
    );
  });

  test("should throw if manifest fetch fails", async () => {
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { error: new Error("Manifest fetch failed") },
      },
    });
    await assert.rejects(
      initializeServerState(httpClient, { baseUrl }),
      /Manifest fetch failed/
    );
  });

  test("should throw if tools fetch fails", async () => {
    const manifestWithTools = { ...mockManifest, tools: "tools" };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithTools },
        [`${baseUrl}/tools`]: { error: new Error("Tools fetch failed") },
      },
    });
    await assert.rejects(
      initializeServerState(httpClient, { baseUrl }),
      /Tools fetch failed/
    );
  });

  test("should throw if prompts fetch fails", async () => {
    const manifestWithPrompts = { ...mockManifest, prompts: "prompts" };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithPrompts },
        [`${baseUrl}/prompts`]: { error: new Error("Prompts fetch failed") },
      },
    });
    await assert.rejects(
      initializeServerState(httpClient, { baseUrl }),
      /Prompts fetch failed/
    );
  });

  test("should throw if resources fetch fails", async () => {
    const manifestWithResources = { ...mockManifest, resources: "resources" };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResources },
        [`${baseUrl}/resources`]: {
          error: new Error("Resources fetch failed"),
        },
      },
    });
    await assert.rejects(
      initializeServerState(httpClient, { baseUrl }),
      /Resources fetch failed/
    );
  });

  test("should throw if resource templates fetch fails", async () => {
    const manifestWithResourceTemplates = {
      ...mockManifest,
      resourceTemplates: "resource_templates",
    };
    const httpClient = createMockHttpClient({
      getUrl: {
        [baseUrl]: { data: manifestWithResourceTemplates },
        [`${baseUrl}/resource_templates`]: {
          error: new Error("Resource templates fetch failed"),
        },
      },
    });
    await assert.rejects(
      initializeServerState(httpClient, { baseUrl }),
      /Resource templates fetch failed/
    );
  });
});

describe("mcpListTools", () => {
  test("should list tools correctly", async () => {
    const mockState = {
      tools: [
        {
          name: "tool1",
          description: "Desc1",
          inputSchema: { type: "object" },
          href: "t1",
        },
        {
          name: "tool2",
          description: "Desc2",
          inputSchema: { type: "string" },
        },
      ],
    };
    const result = await mcpListTools(mockState);
    assert.deepStrictEqual(result, {
      tools: [
        {
          name: "tool1",
          description: "Desc1",
          inputSchema: { type: "object" },
        },
        {
          name: "tool2",
          description: "Desc2",
          inputSchema: { type: "string" },
        },
      ],
    });
  });

  test("should return empty tools array if no tools", async () => {
    const mockState = { tools: [] };
    const result = await mcpListTools(mockState);
    assert.deepStrictEqual(result, { tools: [] });
  });
});

describe("mcpCallTool", () => {
  const baseUrl = "http://localhost:8080";
  const toolsUrl = `${baseUrl}/api/tools`;
  const headers = { "X-Custom-Header": "value" };
  const mockTool1 = {
    name: "getWeather",
    description: "Gets weather",
    inputSchema: {},
    href: "weather",
  };
  const mockTool2 = {
    name: "calculator",
    description: "Calculates",
    inputSchema: {},
  };

  const baseState = {
    baseUrl,
    headers,
    toolsUrl,
    tools: [mockTool1, mockTool2],
  };

  const callToolTestCases = [
    {
      name: "should call a tool successfully",
      toolName: "calculator",
      toolArguments: { query: "2+2" },
      mockResponse: {
        contentType: "application/json",
        body: { result: 4 },
        status: 200,
      },
      expectedResult: { result: 4 },
    },
    {
      name: "should call a tool with href successfully",
      toolName: "getWeather",
      toolArguments: { location: "london" },
      mockResponse: {
        contentType: "application/json",
        body: { temperature: "15C" },
        status: 200,
      },
      expectedResult: { temperature: "15C" },
      toolToUse: mockTool1,
    },
    {
      name: "should call a tool with empty arguments",
      toolName: "calculator",
      toolArguments: {},
      mockResponse: {
        contentType: "application/json",
        body: { result: "default calculation" },
        status: 200,
      },
      expectedResult: { result: "default calculation" },
    },
    {
      name: "should throw if tool not found",
      toolName: "unknownTool",
      toolArguments: {},
      expectedError: /Unknown tool "unknownTool"/,
    },
    {
      name: "should handle 401 Unauthorized",
      toolName: "calculator",
      toolArguments: {},
      mockResponse: {
        contentType: "text/plain",
        body: "Unauthorized access",
        status: 401,
      },
      expectedError: /Unauthorized/,
    },
    {
      name: "should handle 403 Forbidden",
      toolName: "calculator",
      toolArguments: {},
      mockResponse: {
        contentType: "text/plain",
        body: "Forbidden access",
        status: 403,
      },
      expectedError: /Forbidden/,
    },
    {
      name: "should set isError for non-ok responses (e.g., 500)",
      toolName: "calculator",
      toolArguments: {},
      mockResponse: {
        contentType: "application/json",
        body: { message: "Server Error" },
        status: 500,
      },
      expectedResult: { message: "Server Error", isError: true },
    },
    {
      name: "should correctly parse plain text error response and set isError",
      toolName: "calculator",
      toolArguments: {},
      mockResponse: {
        contentType: "text/plain",
        body: "A plain text error occurred",
        status: 400,
      },
      expectedResult: {
        content: [{ type: "text", text: "A plain text error occurred" }],
        isError: true,
      },
    },
  ];

  callToolTestCases.forEach((tc) => {
    test(tc.name, async () => {
      const toolDefinition =
        tc.toolToUse || baseState.tools.find((t) => t.name === tc.toolName);
      const requestUrl =
        toolDefinition && tc.mockResponse
          ? `${toolsUrl}/${toolDefinition.href || toolDefinition.name}`
          : null;

      const httpClient = createMockHttpClient(
        tc.mockResponse
          ? {
              postUrl: {
                [requestUrl]: {
                  contentType: tc.mockResponse.contentType,
                  body: tc.mockResponse.body,
                  status: tc.mockResponse.status,
                  statusText: tc.mockResponse.statusText,
                },
              },
            }
          : {}
      );

      if (tc.expectedError) {
        await assert.rejects(
          mcpCallTool(httpClient, baseState, tc.toolName, tc.toolArguments),
          tc.expectedError
        );
      } else {
        const result = await mcpCallTool(
          httpClient,
          baseState,
          tc.toolName,
          tc.toolArguments
        );
        assert.deepStrictEqual(result, tc.expectedResult);
      }
    });
  });
});

describe("mcpListPrompts", () => {
  test("should list prompts correctly", async () => {
    const mockState = {
      prompts: [
        { name: "p1", description: "Prompt 1", arguments: [] },
        { name: "p2", description: "Prompt 2" },
      ],
    };

    const result = await mcpListPrompts(mockState);
    assert.deepStrictEqual(result, {
      prompts: [
        { name: "p1", description: "Prompt 1", arguments: [] },
        { name: "p2", description: "Prompt 2", arguments: undefined },
      ],
    });
  });
});

describe("mcpGetPrompt", () => {
  const mockHttpClient = createMockHttpClient({
    getUrl: {
      "http://localhost/prompts/test-prompt": {
        contentType: "application/json",
        data: {
          messages: [
            { role: "user", content: { type: "text", text: "Hello" } },
          ],
        },
        status: 200,
      },
      "http://localhost/prompts/text-prompt": {
        contentType: "text/plain",
        data: "Just text",
        status: 200,
      },
      "http://localhost/prompts/error-prompt": {
        contentType: "application/json",
        data: { error: "failed" },
        status: 500,
        statusText: "Internal Server Error",
      },
      "http://localhost/prompts/simple-json-prompt": {
        contentType: "application/json",
        data: { customData: "value", number: 123 },
        status: 200,
      },
      "http://localhost/prompts/xml-prompt": {
        contentType: "application/xml",
        data: "<data>test</data>",
        status: 200,
      },
      "http://localhost/prompts/unauthorized-prompt": {
        contentType: "text/plain",
        data: "Unauthorized access",
        status: 401,
        statusText: "Unauthorized",
      },
      "http://localhost/prompts/forbidden-prompt": {
        contentType: "text/plain",
        data: "Forbidden access",
        status: 403,
        statusText: "Forbidden",
      },
      "http://localhost/prompts/weather-prompt?location=london&language=english":
        {
          contentType: "application/json",
          data: {
            messages: [
              {
                role: "user",
                content: { type: "text", text: "Weather in London in English" },
              },
            ],
          },
          status: 200,
        },
    },
  });

  const mockState = {
    baseUrl: "http://localhost",
    promptsUrl: "http://localhost/prompts",
    prompts: [
      { name: "test-prompt", description: "Test prompt" },
      { name: "text-prompt", description: "Text prompt" },
      { name: "error-prompt", description: "Error prompt" },
      { name: "simple-json-prompt", description: "Simple JSON prompt" },
      { name: "xml-prompt", description: "XML prompt" },
      { name: "unauthorized-prompt", description: "Unauthorized prompt" },
      { name: "forbidden-prompt", description: "Forbidden prompt" },
      { name: "weather-prompt", description: "Weather" },
    ],
    headers: { "X-Test": "test" },
  };

  test("should get a prompt and return JSON content correctly", async () => {
    const result = await mcpGetPrompt(
      mockHttpClient,
      mockState,
      "test-prompt",
      {}
    );

    assert.deepStrictEqual(result, {
      messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
    });
  });

  test("should get a prompt with arguments passed as query parameters", async () => {
    const result = await mcpGetPrompt(
      mockHttpClient,
      mockState,
      "weather-prompt",
      { location: "london", language: "english" }
    );

    assert.deepStrictEqual(result, {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Weather in London in English" },
        },
      ],
    });
  });

  test("should get a prompt and return text content correctly", async () => {
    const result = await mcpGetPrompt(
      mockHttpClient,
      mockState,
      "text-prompt",
      {}
    );

    assert.deepStrictEqual(result, {
      messages: [
        { role: "user", content: { type: "text", text: "Just text" } },
      ],
    });
  });

  test("should get a prompt and wrap simple JSON object in text message", async () => {
    const result = await mcpGetPrompt(
      mockHttpClient,
      mockState,
      "simple-json-prompt",
      {}
    );

    assert.deepStrictEqual(result, {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: '{"customData":"value","number":123}',
          },
        },
      ],
    });
  });

  test("should throw an error if prompt is not found", async () => {
    await assert.rejects(
      mcpGetPrompt(mockHttpClient, mockState, "unknown-prompt", {}),
      /Unknown prompt "unknown-prompt"/
    );
  });

  test("should throw an error for HTTP errors", async () => {
    await assert.rejects(
      mcpGetPrompt(mockHttpClient, mockState, "error-prompt", {}),
      /Failed to get prompt "error-prompt": 500 Internal Server Error/
    );
  });

  test("should throw an error for 401 Unauthorized", async () => {
    await assert.rejects(
      mcpGetPrompt(mockHttpClient, mockState, "unauthorized-prompt", {}),
      /Unauthorized/
    );
  });

  test("should throw an error for 403 Forbidden", async () => {
    await assert.rejects(
      mcpGetPrompt(mockHttpClient, mockState, "forbidden-prompt", {}),
      /Forbidden/
    );
  });

  test("should throw an error for unsupported content type", async () => {
    await assert.rejects(
      mcpGetPrompt(mockHttpClient, mockState, "xml-prompt", {}),
      /Unsupported content type "application\/xml"/
    );
  });
});

describe("mcpListResources", () => {
  test("should list resources correctly", async () => {
    const mockState = {
      resources: [
        {
          uri: "file://test1.txt",
          name: "test1.txt",
          description: "Test file 1",
          mimeType: "text/plain",
        },
        {
          uri: "file://test2.json",
          name: "test2.json",
          description: "Test JSON file",
          mimeType: "application/json",
        },
      ],
    };
    const result = await mcpListResources(mockState);
    assert.deepStrictEqual(result, {
      resources: [
        {
          uri: "file://test1.txt",
          name: "test1.txt",
          description: "Test file 1",
          mimeType: "text/plain",
        },
        {
          uri: "file://test2.json",
          name: "test2.json",
          description: "Test JSON file",
          mimeType: "application/json",
        },
      ],
    });
  });

  test("should return empty resources array if no resources", async () => {
    const mockState = { resources: [] };
    const result = await mcpListResources(mockState);
    assert.deepStrictEqual(result, { resources: [] });
  });

  test("should handle resources without optional fields", async () => {
    const mockState = {
      resources: [
        {
          uri: "file://minimal.txt",
          name: "minimal.txt",
        },
      ],
    };
    const result = await mcpListResources(mockState);
    assert.deepStrictEqual(result, {
      resources: [
        {
          uri: "file://minimal.txt",
          name: "minimal.txt",
          description: undefined,
          mimeType: undefined,
        },
      ],
    });
  });
});

describe("mcpReadResource", () => {
  const baseUrl = "http://localhost:8080";
  const resourcesUrl = `${baseUrl}/api/resources`;
  const headers = { "X-Custom-Header": "value" };

  const mockTextResource = {
    uri: "file://test.txt",
    name: "test.txt",
    description: "Test text file",
    mimeType: "text/plain",
  };

  const mockJsonResource = {
    uri: "file://data.json",
    name: "data.json",
    description: "Test JSON file",
    mimeType: "application/json",
  };

  const mockImageResource = {
    uri: "file://image.png",
    name: "image.png",
    description: "Test image",
    mimeType: "image/png",
  };

  const mockMultiResource = {
    uri: "file://multi.txt",
    name: "multi.txt",
    description: "Test multi-content file",
    mimeType: "text/plain",
  };

  const mockMinimalResource = {
    uri: "file://minimal.txt",
    name: "minimal.txt",
  };

  const mockHrefResource = {
    uri: "file://href-test.txt",
    name: "href-test.txt",
    description: "Test resource with href",
    mimeType: "text/plain",
    href: "custom-resource-path",
  };

  const mockXmlResource = {
    uri: "file://data.xml",
    name: "data.xml",
    description: "Test XML file",
    mimeType: "application/xml",
  };

  const mockCsvResource = {
    uri: "file://data.csv",
    name: "data.csv",
    description: "Test CSV file",
    mimeType: "text/csv",
  };

  const mockPdfResource = {
    uri: "file://document.pdf",
    name: "document.pdf",
    description: "Test PDF file",
    mimeType: "application/pdf",
  };

  const baseState = {
    baseUrl,
    headers,
    resourcesUrl,
    resources: [
      mockTextResource,
      mockJsonResource,
      mockImageResource,
      mockMultiResource,
      mockMinimalResource,
      mockHrefResource,
      mockXmlResource,
      mockCsvResource,
      mockPdfResource,
    ],
  };

  const readResourceTestCases = [
    {
      name: "should read a text resource successfully",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "application/json",
        body: {
          contents: [
            {
              uri: "file://test.txt",
              mimeType: "text/plain",
              text: "Hello, world!",
            },
          ],
        },
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "text/plain",
            text: "Hello, world!",
          },
        ],
      },
    },
    {
      name: "should read a JSON resource successfully",
      resourceUri: "file://data.json",
      mockResponse: {
        contentType: "application/json",
        body: {
          contents: [
            {
              uri: "file://data.json",
              mimeType: "application/json",
              text: '{"key": "value"}',
            },
          ],
        },
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://data.json",
            mimeType: "application/json",
            text: '{"key": "value"}',
          },
        ],
      },
    },
    {
      name: "should read a binary resource successfully",
      resourceUri: "file://image.png",
      mockResponse: {
        contentType: "application/json",
        body: {
          contents: [
            {
              uri: "file://image.png",
              mimeType: "image/png",
              blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            },
          ],
        },
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://image.png",
            mimeType: "image/png",
            blob: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
          },
        ],
      },
    },
    {
      name: "should read multiple contents in one resource",
      resourceUri: "file://multi.txt",
      mockResponse: {
        contentType: "application/json",
        body: {
          contents: [
            {
              uri: "file://multi.txt",
              mimeType: "text/plain",
              text: "Part 1",
            },
            {
              uri: "file://multi.txt",
              mimeType: "text/plain",
              text: "Part 2",
            },
          ],
        },
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://multi.txt",
            mimeType: "text/plain",
            text: "Part 1",
          },
          {
            uri: "file://multi.txt",
            mimeType: "text/plain",
            text: "Part 2",
          },
        ],
      },
    },
    {
      name: "should throw if resource not found",
      resourceUri: "file://unknown.txt",
      expectedError: /Unknown resource "file:\/\/unknown\.txt"/,
    },
    {
      name: "should handle 401 Unauthorized",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/plain",
        body: "Unauthorized access",
        status: 401,
      },
      expectedError: /Unauthorized/,
    },
    {
      name: "should handle 403 Forbidden",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/plain",
        body: "Forbidden access",
        status: 403,
      },
      expectedError: /Forbidden/,
    },
    {
      name: "should handle 404 Not Found",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "application/json",
        body: { error: "Resource not found" },
        status: 404,
      },
      expectedError: /Failed to read resource/,
    },
    {
      name: "should handle server errors (500)",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "application/json",
        body: { error: "Internal server error" },
        status: 500,
      },
      expectedError: /Failed to read resource/,
    },
    {
      name: "should handle plain text error responses",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/plain",
        body: "Resource processing failed",
        status: 422,
      },
      expectedError: /Failed to read resource/,
    },
    {
      name: "should use href field when available",
      resourceUri: "file://href-test.txt",
      mockResponse: {
        contentType: "application/json",
        body: {
          contents: [
            {
              uri: "file://href-test.txt",
              mimeType: "text/plain",
              text: "Content from href resource",
            },
          ],
        },
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://href-test.txt",
            mimeType: "text/plain",
            text: "Content from href resource",
          },
        ],
      },
    },
  ];

  const nonJsonResourceTestCases = [
    {
      name: "should read a plain text resource successfully",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/plain",
        body: "This is plain text content\nWith multiple lines\nAnd some data",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "text/plain",
            text: "This is plain text content\nWith multiple lines\nAnd some data",
          },
        ],
      },
    },
    {
      name: "should read an XML resource successfully",
      resourceUri: "file://data.xml",
      mockResponse: {
        contentType: "application/xml",
        body: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item id="1">Value 1</item>\n  <item id="2">Value 2</item>\n</root>',
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://data.xml",
            mimeType: "application/xml",
            text: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item id="1">Value 1</item>\n  <item id="2">Value 2</item>\n</root>',
          },
        ],
      },
    },
    {
      name: "should read a CSV resource successfully",
      resourceUri: "file://data.csv",
      mockResponse: {
        contentType: "text/csv",
        body: "name,age,city\nJohn,30,New York\nJane,25,Los Angeles\nBob,35,Chicago",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://data.csv",
            mimeType: "text/csv",
            text: "name,age,city\nJohn,30,New York\nJane,25,Los Angeles\nBob,35,Chicago",
          },
        ],
      },
    },
    {
      name: "should read a binary PDF resource successfully",
      resourceUri: "file://document.pdf",
      mockResponse: {
        contentType: "application/pdf",
        body: "fakeBase64PDFData",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://document.pdf",
            mimeType: "application/pdf",
            blob: btoa("fakeBase64PDFData"),
          },
        ],
      },
    },
    {
      name: "should read a resource with empty content type (default to binary)",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "",
        body: "emptyContentTypeData",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "application/octet-stream",
            blob: btoa("emptyContentTypeData"),
          },
        ],
      },
    },
    {
      name: "should read a text resource with charset information",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/plain; charset=utf-8",
        body: "Text with charset information",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "text/plain; charset=utf-8",
            text: "Text with charset information",
          },
        ],
      },
    },
    {
      name: "should read an HTML resource successfully",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/html",
        body: "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "text/html",
            text: "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>",
          },
        ],
      },
    },
    {
      name: "should read a JavaScript resource successfully",
      resourceUri: "file://test.txt",
      mockResponse: {
        contentType: "text/javascript",
        body: "function hello() {\n  console.log('Hello, world!');\n}",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://test.txt",
            mimeType: "text/javascript",
            text: "function hello() {\n  console.log('Hello, world!');\n}",
          },
        ],
      },
    },
    {
      name: "should read an image resource as binary blob",
      resourceUri: "file://image.png",
      mockResponse: {
        contentType: "image/png",
        body: "fakeImageBinaryData",
        status: 200,
      },
      expectedResult: {
        contents: [
          {
            uri: "file://image.png",
            mimeType: "image/png",
            blob: btoa("fakeImageBinaryData"),
          },
        ],
      },
    },
  ];

  readResourceTestCases.forEach((tc) => {
    test(tc.name, async () => {
      let requestUrl = null;
      if (tc.mockResponse) {
        const resource = baseState.resources.find(
          (r) => r.uri === tc.resourceUri
        );
        if (resource) {
          const queryParams = new URLSearchParams({ uri: tc.resourceUri });
          requestUrl = resource.href
            ? `${resourcesUrl}/${resource.href}?${queryParams.toString()}`
            : `${resourcesUrl}?${queryParams.toString()}`;
        }
      }

      const httpClient = createMockHttpClient(
        tc.mockResponse && requestUrl
          ? {
              getUrl: {
                [requestUrl]: {
                  data: tc.mockResponse.body,
                  contentType: tc.mockResponse.contentType,
                  status: tc.mockResponse.status,
                  statusText: tc.mockResponse.statusText,
                },
              },
            }
          : {}
      );

      if (tc.expectedError) {
        await assert.rejects(
          mcpReadResource(httpClient, baseState, tc.resourceUri, {}),
          tc.expectedError
        );
      } else {
        const result = await mcpReadResource(
          httpClient,
          baseState,
          tc.resourceUri,
          {}
        );
        assert.deepStrictEqual(result, tc.expectedResult);
      }
    });
  });

  nonJsonResourceTestCases.forEach((tc) => {
    test(tc.name, async () => {
      const mockHttpClient = createMockHttpClient({
        getUrl: {
          [`${resourcesUrl}?uri=${encodeURIComponent(tc.resourceUri)}`]: {
            contentType: tc.mockResponse.contentType,
            data: tc.mockResponse.body,
            status: tc.mockResponse.status,
            statusText: tc.mockResponse.statusText,
          },
        },
      });

      const result = await mcpReadResource(
        mockHttpClient,
        baseState,
        tc.resourceUri
      );

      assert.deepStrictEqual(result, tc.expectedResult);
    });
  });

  test("should pass custom arguments to resource read request", async () => {
    const resourceUri = "file://test.txt";
    const customArgs = { encoding: "utf-8", range: "0-100" };
    const queryParams = new URLSearchParams({
      uri: resourceUri,
      ...customArgs,
    });
    const requestUrl = `${resourcesUrl}?${queryParams.toString()}`;

    const httpClient = createMockHttpClient({
      getUrl: {
        [requestUrl]: {
          data: {
            contents: [
              {
                uri: resourceUri,
                mimeType: "text/plain",
                text: "Custom content",
              },
            ],
          },
        },
      },
    });

    const result = await mcpReadResource(
      httpClient,
      baseState,
      resourceUri,
      customArgs
    );

    assert.deepStrictEqual(result, {
      contents: [
        {
          uri: resourceUri,
          mimeType: "text/plain",
          text: "Custom content",
        },
      ],
    });
  });

  test("should handle empty contents array", async () => {
    const resourceUri = "file://test.txt";
    const queryParams = new URLSearchParams({ uri: resourceUri });
    const requestUrl = `${resourcesUrl}?${queryParams.toString()}`;

    const httpClient = createMockHttpClient({
      getUrl: {
        [requestUrl]: {
          data: {
            contents: [],
          },
        },
      },
    });

    const result = await mcpReadResource(
      httpClient,
      baseState,
      resourceUri,
      {}
    );

    assert.deepStrictEqual(result, {
      contents: [],
    });
  });

  test("should handle resource with minimal content fields", async () => {
    const resourceUri = "file://minimal.txt";
    const queryParams = new URLSearchParams({ uri: resourceUri });
    const requestUrl = `${resourcesUrl}?${queryParams.toString()}`;

    const httpClient = createMockHttpClient({
      getUrl: {
        [requestUrl]: {
          data: {
            contents: [
              {
                uri: resourceUri,
                text: "Minimal content",
              },
            ],
          },
        },
      },
    });

    const result = await mcpReadResource(
      httpClient,
      baseState,
      resourceUri,
      {}
    );

    assert.deepStrictEqual(result, {
      contents: [
        {
          uri: resourceUri,
          text: "Minimal content",
        },
      ],
    });
  });
});

describe("mcpListResourceTemplates", () => {
  test("should list resource templates correctly", async () => {
    const mockState = {
      resourceTemplates: [
        {
          uriTemplate: "file://{path}",
          name: "fileTemplate",
          description: "Template for file resources",
          mimeType: "text/plain",
        },
        {
          uriTemplate: "http://api.example.com/{endpoint}",
          name: "apiTemplate",
          description: "Template for API endpoints",
          mimeType: "application/json",
        },
      ],
    };
    const result = await mcpListResourceTemplates(mockState);
    assert.deepStrictEqual(result, {
      resourceTemplates: [
        {
          uriTemplate: "file://{path}",
          name: "fileTemplate",
          description: "Template for file resources",
          mimeType: "text/plain",
        },
        {
          uriTemplate: "http://api.example.com/{endpoint}",
          name: "apiTemplate",
          description: "Template for API endpoints",
          mimeType: "application/json",
        },
      ],
    });
  });

  test("should return empty resource templates array if no templates", async () => {
    const mockState = { resourceTemplates: [] };
    const result = await mcpListResourceTemplates(mockState);
    assert.deepStrictEqual(result, { resourceTemplates: [] });
  });

  test("should handle resource templates without optional fields", async () => {
    const mockState = {
      resourceTemplates: [
        {
          uriTemplate: "minimal://{id}",
          name: "minimalTemplate",
        },
      ],
    };
    const result = await mcpListResourceTemplates(mockState);
    assert.deepStrictEqual(result, {
      resourceTemplates: [
        {
          uriTemplate: "minimal://{id}",
          name: "minimalTemplate",
          description: undefined,
          mimeType: undefined,
        },
      ],
    });
  });

  test("should handle resource templates with href", async () => {
    const mockState = {
      resourceTemplates: [
        {
          uriTemplate: "custom://{type}/{id}",
          name: "customTemplate",
          description: "Custom template with href",
          mimeType: "application/json",
          href: "custom-endpoint",
        },
      ],
    };
    const result = await mcpListResourceTemplates(mockState);
    assert.deepStrictEqual(result, {
      resourceTemplates: [
        {
          uriTemplate: "custom://{type}/{id}",
          name: "customTemplate",
          description: "Custom template with href",
          mimeType: "application/json",
        },
      ],
    });
  });
});
