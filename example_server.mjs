/**
 * @file A simple SSMCP server with one example of each type.
 */
import http from "http";
import https from "https";

const manifest = {
  name: "example",
  version: "1.0.0",
  tools: true,
  prompts: true,
  resources: true,
};

const tools = [
  {
    name: "cat_say",
    description: "Get a cat image with custom text",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text for the cat to say" },
      },
      required: ["text"],
    },
  },
];

const prompts = [
  {
    name: "explain",
    description: "Generate a prompt to explain a concept",
    arguments: [
      {
        name: "concept",
        description: "The concept to explain",
        required: true,
      },
    ],
  },
];

const resources = [
  {
    uri: "file://readme.txt",
    name: "README",
    description: "A simple readme file",
    mimeType: "text/plain",
  },
];

const sendJson = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
};

const sendText = (res, text, status = 200) => {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(String(text));
};

const getQueryParam = (req, param) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get(param);
};

const readBody = async (req) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
};

const routes = {
  "/": (req, res) => sendJson(res, manifest),
  "/tools": (req, res) => sendJson(res, tools),
  "/tools/cat_say": async (req, res) => {
    const { text } = await readBody(req);
    const encodedText = encodeURIComponent(text || "Hello!");
    https
      .get(`https://cataas.com/cat/says/${encodedText}`, (catRes) => {
        res.writeHead(catRes.statusCode, {
          "Content-Type": catRes.headers["content-type"] || "image/jpeg",
        });
        catRes.pipe(res);
      })
      .on("error", (e) => sendText(res, `Error: ${e.message}`, 500));
  },
  "/prompts": (req, res) => sendJson(res, prompts),
  "/prompts/explain": async (req, res) => {
    const concept = getQueryParam(req, "concept");
    sendJson(res, {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please explain the concept of "${concept}" in simple terms.`,
          },
        },
      ],
    });
  },
  "/resources": (req, res) => {
    const uri = getQueryParam(req, "uri");
    if (!uri) return sendJson(res, resources);

    if (uri === "file://readme.txt") {
      sendText(
        res,
        "This is a simple SSMCP server example.\n\nFeatures:\n- Cat images\n- Concept explanations\n- File resources"
      );
    } else {
      sendText(res, `Resource not found: ${uri}`, 404);
    }
  },
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const handler = routes[pathname];

  if (handler) {
    try {
      await handler(req, res);
    } catch (e) {
      sendText(res, e.message, 500);
    }
  } else {
    sendText(res, "Not Found", 404);
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("Server running at http://127.0.0.1:3000/");
});
