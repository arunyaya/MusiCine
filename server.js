require("dotenv").config();
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = 3000;

const { YT_API_KEY, GEMINI_API_KEY } = process.env;

const MIME_TYPES = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".mp3":  "audio/mpeg",
  ".wav":  "audio/wav",
  ".flac": "audio/flac",
  ".ogg":  "audio/ogg",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
};

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── 1. YouTube Search ──────────────────────────────────────────────────────
  if (pathname === "/yt/search" && req.method === "GET") {
    const q = parsed.query.q || "";
    if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing query" })); return; }
    try {
      const result = await httpsGet({
        hostname: "www.googleapis.com",
        path: `/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(q)}&key=${YT_API_KEY}`,
        method: "GET",
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 2. AI endpoint (Gemini) ────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/ai") {
    const body = await readBody(req);
    let parsedBody;
    try { parsedBody = JSON.parse(body); }
    catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

    const prompt = `
${parsedBody.system || "You are a helpful music assistant."}

${(parsedBody.messages || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}
`;
    const geminiBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

    try {
      const result = await httpsPost({
        hostname: "generativelanguage.googleapis.com",
        path: `/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(geminiBody),
        },
      }, geminiBody);

      if (result.status !== 200) {
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(result.body);
        return;
      }
      const json = JSON.parse(result.body);
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text }] }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 3. Static file server ──────────────────────────────────────────────────
  let filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end(`File not found: ${filePath}`); return; }
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`✅ MusiCine running at http://localhost:${PORT}`);
});