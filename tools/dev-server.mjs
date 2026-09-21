// ============================================================
// tools/dev-server.mjs — local dev server that mirrors vercel.json routing.
//
//   node tools/dev-server.mjs [port]
//
// Behaviour (same as production on Vercel):
//   • static files from the repo root
//   • /sitemap.xml            → api/sitemap.js
//   • /app/{slug}, /game/{slug} with a crawler user-agent → api/app-page.js
//   • /app/{slug}, /game/{slug} and the info routes       → index.html shell
//   • /admin…                 → admin/index.html
//   • anything else           → 404.html with status 404
//
// Not deployed (listed in .vercelignore) — development/testing only.
// ============================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8010);

// Same crawler pattern as vercel.json
const CRAWLER_RE = /(bot|crawl|spider|slurp|facebookexternalhit|facebot|twitterbot|whatsapp|telegrambot|linkedinbot|slackbot|discordbot|redditbot|embedly|outbrain|pinterest|applebot|vkshare|w3c_validator|google-inspectiontool|googleother|bingpreview|iframely|seznambot|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|naver|exabot|ia_archiver|linkpreview|flipboard|qwantify|unfurl|preview)/i;

const SPA_PATHS = new Set(["/apps", "/games", "/search", "/faq", "/terms", "/privacy", "/disclaimer"]);
const DETAIL_RE = /^\/(app|game)\/([a-z0-9][a-z0-9-]{0,79})\/?$/i;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const sitemapHandler = require(path.join(ROOT, "api/sitemap.js"));
const appPageHandler = require(path.join(ROOT, "api/app-page.js"));
const visitHandler = require(path.join(ROOT, "api/visit.js"));
const appUpdateHandler = require(path.join(ROOT, "api/app-update.js"));

// Vercel's Node runtime hands functions an Express-style response object.
// Shim the two methods used by api/*.js so the same code runs locally.
function vercelizeRes(res) {
  if (!res.status) {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (!res.send) {
    res.send = (body) => res.end(body);
  }
  return res;
}

function serveStatic(res, filePath, status = 200) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(status, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  const ua = req.headers["user-agent"] || "";

  // Give the serverless functions the same env Vercel would (overridable for tests)
  process.env.SHELL_BASE_URL = process.env.SHELL_BASE_URL || `http://127.0.0.1:${PORT}`;

  try {
    if (pathname === "/sitemap.xml") return await sitemapHandler(req, vercelizeRes(res));
    if (pathname === "/api/visit") return await visitHandler(req, vercelizeRes(res));
    if (pathname === "/api/app-update") return await appUpdateHandler(req, vercelizeRes(res));

    const detail = pathname.match(DETAIL_RE);
    if (detail) {
      if (CRAWLER_RE.test(ua)) {
        req.url = `/api/app-page?type=${detail[1].toLowerCase()}&slug=${encodeURIComponent(detail[2])}`;
        return await appPageHandler(req, vercelizeRes(res));
      }
      return serveStatic(res, path.join(ROOT, "index.html"));
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      return serveStatic(res, path.join(ROOT, "admin/index.html"));
    }

    if (pathname === "/" || pathname === "/index.html") {
      return serveStatic(res, path.join(ROOT, "index.html"));
    }

    if (SPA_PATHS.has(pathname)) {
      return serveStatic(res, path.join(ROOT, "index.html"));
    }

    // Try a real static file (style.css, app.js, icons/…)
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, safePath);
    if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStatic(res, filePath);
    }

    // 404
    if (!serveStatic(res, path.join(ROOT, "404.html"), 404)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
    }
  } catch (err) {
    console.error("dev-server error:", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Sayem WebStore dev server → http://127.0.0.1:${PORT} (mirrors vercel.json routing)`);
});
