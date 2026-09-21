// Integration tests — real HTTP against tools/dev-server.mjs (mirrors vercel.json)
// with a mock Firebase REST endpoint serving deterministic fixtures.
// Run: node tests/functions.test.mjs
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suite, test, assert, assertEq, assertIncludes, assertNotIncludes, summarize } from "./harness.mjs";
import { FIXTURE_APPS, FIXTURE_USERS, fixtureAppsArray } from "./fixtures.mjs";
import { buildAppSlugIndex, getAppPath } from "../seo-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = 8123;
const MOCK_FB_PORT = 8124;
const DEV = `http://127.0.0.1:${DEV_PORT}`;
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const FACEBOOKBOT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const HUMAN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const apps = fixtureAppsArray();
const index = buildAppSlugIndex(apps);
const calc = apps.find((a) => a.key === "-Test0001keyAAA");
const game = apps.find((a) => a.key === "-Test0002keyBBB");
const legacy = apps.find((a) => a.key === "-Test0003keyCCC");
const calcPath = getAppPath(calc, index);
const gamePath = getAppPath(game, index);
const legacyPath = getAppPath(legacy, index);

// ---- mock Firebase REST ----
const fbStore = new Map();
const mockFb = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "PUT" || req.method === "PATCH") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      fbStore.set(url.pathname, b);
      res.end("null");
    });
    return;
  }
  const stored = fbStore.get(url.pathname);
  if (stored !== undefined) return res.end(stored);
  if (url.pathname === "/apps.json") return res.end(JSON.stringify(FIXTURE_APPS));
  if (url.pathname === "/users.json") return res.end(JSON.stringify(FIXTURE_USERS));
  if (url.pathname === "/settings/websiteName.json") return res.end("null");
  res.end("null");
});

// ---- dev server (mirrors vercel.json) ----
const dev = spawn(process.execPath, [path.join(ROOT, "tools/dev-server.mjs"), String(DEV_PORT)], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(DEV_PORT),
    FIREBASE_DATABASE_URL: `http://127.0.0.1:${MOCK_FB_PORT}`,
    SHELL_BASE_URL: DEV,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
dev.stderr.on("data", (d) => process.env.DEBUG_TESTS && console.error("[dev]", String(d)));

async function waitForServer(base, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(base + "/");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server at ${base} did not start`);
}

async function get(pathname, ua = HUMAN) {
  const res = await fetch(DEV + pathname, { headers: { "User-Agent": ua }, redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}

await mockFb.listen(MOCK_FB_PORT, "127.0.0.1");
await waitForServer(DEV);
console.log(`dev server on ${DEV_PORT}, mock firebase on ${MOCK_FB_PORT}`);

try {
  // ============ ROUTING MATRIX ============
  suite("Routing (vercel.json parity)");
  await test("GET / → shell 200 with production SEO head", async () => {
    const { status, body } = await get("/");
    assertEq(status, 200);
    assertIncludes(body, "<title>Sayem WebStore — Free Apps &amp; Games Download</title>");
    assertIncludes(body, 'rel="canonical" href="https://sayemwebstore.vercel.app/"');
    assertNotIncludes(body, "samva-app-store.firebaseapp.com");
    assertNotIncludes(body, "SamWeb Store");
  });
  await test("SPA routes serve the shell (200)", async () => {
    for (const p of ["/apps", "/games", "/search", "/faq", "/terms", "/privacy", "/disclaimer"]) {
      const { status, body } = await get(p);
      assertEq(status, 200, p);
      assertIncludes(body, 'id="homePage"', p);
    }
  });
  await test("human /app/{slug} → fast static shell (client router renders)", async () => {
    const { status, body } = await get(calcPath);
    assertEq(status, 200);
    assertIncludes(body, 'id="appDetailPageContent"></div>'); // untouched shell
  });
  await test("unknown random path → real 404 page + status", async () => {
    const { status, body } = await get("/totally-bogus-path");
    assertEq(status, 404);
    assertIncludes(body, "404");
    assertIncludes(body, "Sayem WebStore");
  });
  await test("/admin serves the admin panel", async () => {
    const { status, body } = await get("/admin");
    assertEq(status, 200);
    assertIncludes(body, "Sayem WebStore • Admin Panel");
  });

  // ============ CRAWLER-FACING APP PAGES ============
  suite("Crawler pre-rendered app pages (api/app-page)");
  await test("Googlebot /app/{slug} → unique title/canonical/OG/JSON-LD/content", async () => {
    const { status, body } = await get(calcPath, GOOGLEBOT);
    assertEq(status, 200);
    assertIncludes(body, "<title>Sam Calculator — Free App Download | Sayem WebStore</title>");
    assertIncludes(body, `href="https://sayemwebstore.vercel.app${calcPath}"`);
    assertIncludes(body, 'property="og:title" content="Sam Calculator — App Download | Sayem WebStore"');
    assertIncludes(body, 'property="og:image" content="https://cdn.example.test/calc.png"');
    assertIncludes(body, '"@type":"SoftwareApplication"');
    assertIncludes(body, '"softwareVersion":"2.5.1"');
    assertIncludes(body, '"com.samva.calculator"');
    assertIncludes(body, '<h1 class="app-detail-name">Sam Calculator</h1>');
    assertIncludes(body, '<div id="appDetailPage" class="page active">');
    assertIncludes(body, '<main id="homePage" class="page">');
    assertIncludes(body, "breadcrumbs");
  });
  await test("Facebook bot /game/{slug} → game page with real reviews + aggregateRating", async () => {
    const { status, body } = await get(gamePath, FACEBOOKBOT);
    assertEq(status, 200);
    assertIncludes(body, "Samva Online Tic Tac Toe — Free Game Download");
    assertIncludes(body, '"aggregateRating"');
    assertIncludes(body, '"ratingValue":4.5');
    assertIncludes(body, '"reviewCount":2');
    assertIncludes(body, "Rahim");
    assertIncludes(body, "Great game, no lag!");
  });
  await test("crawler page keeps internal links crawlable (related apps)", async () => {
    const { body } = await get(calcPath, GOOGLEBOT);
    assertIncludes(body, `href="${gamePath}"`);
    assertIncludes(body, 'href="/apps"');
  });
  await test("legacy app without version fields → renders fine, no fabricated data", async () => {
    const { status, body } = await get(legacyPath, GOOGLEBOT);
    assertEq(status, 200);
    assertIncludes(body, "CloudKeep Notebook");
    assertNotIncludes(body, "Package Name");
    assertNotIncludes(body, '"aggregateRating"'); // no reviews → none invented
    assertNotIncludes(body, "<lastmod>");
  });
  await test("unknown slug → real 404 for crawlers (never another app)", async () => {
    const { status, body } = await get("/app/not-existing-app-xyz", GOOGLEBOT);
    assertEq(status, 404);
    assertNotIncludes(body, "Sam Calculator");
    assertIncludes(body, "404");
  });
  await test("malformed slug → 404", async () => {
    const { status } = await get("/app/!!bad-slug!!", GOOGLEBOT);
    assert(status === 404 || status === 400, `expected 4xx, got ${status}`);
  });
  await test("wrong type prefix → 301 to canonical path", async () => {
    const slug = calcPath.split("/")[2];
    const res = await fetch(`${DEV}/game/${slug}`, { headers: { "User-Agent": GOOGLEBOT }, redirect: "manual" });
    assertEq(res.status, 301);
    assertEq(res.headers.get("location"), `https://sayemwebstore.vercel.app${calcPath}`);
  });
  await test("duplicate-name apps resolve to distinct pages", async () => {
    const dupes = apps.filter((a) => a.name === "Sam Calculator");
    const paths = dupes.map((a) => getAppPath(a, index));
    assert(paths[0] !== paths[1]);
    for (const p of paths) {
      const { status, body } = await get(p, GOOGLEBOT);
      assertEq(status, 200, p);
      assertIncludes(body, `href="https://sayemwebstore.vercel.app${p}"`);
    }
  });

  // ============ SITEMAP ============
  suite("Dynamic sitemap (/sitemap.xml)");
  await test("valid XML with real app URLs, no admin/utm URLs", async () => {
    const { status, body, headers } = await get("/sitemap.xml");
    assertEq(status, 200);
    assertIncludes(headers.get("content-type"), "xml");
    assertIncludes(body, "<urlset");
    assertIncludes(body, "<loc>https://sayemwebstore.vercel.app/</loc>");
    assertIncludes(body, `<loc>https://sayemwebstore.vercel.app${calcPath}</loc>`);
    assertIncludes(body, `<loc>https://sayemwebstore.vercel.app${gamePath}</loc>`);
    assertNotIncludes(body, "utm_");
    assertNotIncludes(body, "/admin");
    assertNotIncludes(body, "firebasestorage");
    // every fixture app present exactly once
    for (const app of apps) {
      const p = getAppPath(app, index);
      const n = body.split(`<loc>https://sayemwebstore.vercel.app${p}</loc>`).length - 1;
      assertEq(n, 1, `sitemap occurrences of ${p}`);
    }
    // cache headers for the CDN
    assertIncludes(headers.get("cache-control") || "", "s-maxage");
  });
  await test("lastmod reflects real updatedAt only", async () => {
    const { body } = await get("/sitemap.xml");
    assertIncludes(body, new Date(calc.updatedAt).toISOString().slice(0, 10));
    const legacyBlock = body.split("<url>").find((b) => b.includes(legacyPath));
    assertNotIncludes(legacyBlock, "<lastmod>");
  });

  // ============ HEADERS ============
  suite("Response headers");
  await test("nosniff + referrer-policy on shell", async () => {
    const { headers } = await get("/");
    assertEq(headers.get("x-content-type-options"), "nosniff");
    assertEq(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });
  await test("PWA assets served", async () => {
    for (const p of ["/manifest.json", "/service-worker.js", "/seo-utils.js", "/attribution.js", "/icons/icon-192.png"]) {
      const { status } = await get(p);
      assertEq(status, 200, p);
    }
    const { body } = await get("/manifest.json");
    const manifest = JSON.parse(body);
    assertEq(manifest.name, "Sayem WebStore");
  });
  suite("Anonymous aggregate analytics (/api/visit)");
  await test("POST aggregates daily source/landing/campaign counters", async () => {
    const res = await fetch(`${DEV}/api/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "facebook", sourceType: "Social", campaign: "launch_2026", landing: "/app/kotha-bolbo?utm_source=x" }),
    });
    assertEq(res.status, 204);
    assert(!res.headers.get("set-cookie"), "analytics endpoint must not set cookies");
    const day = new Date().toISOString().slice(0, 10);
    const fb = async (p) => (await fetch(`http://127.0.0.1:${MOCK_FB_PORT}${p}.json`)).json();
    assertEq(await fb(`/analytics/daily/${day}/sources/Facebook/visits`), 1);
    assertEq(await fb(`/analytics/daily/${day}/landing/~app~kotha-bolbo/visits`), 1);
    assertEq(await fb(`/analytics/daily/${day}/campaigns/launch_2026/visits`), 1);
    assertEq(await fb(`/analytics/daily/${day}/visits`), 1);
  });
  await test("garbage input normalizes; GET + OPTIONS supported", async () => {
    await fetch(`${DEV}/api/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "<script>alert(1)</script>", sourceType: "Hacker", campaign: "x".repeat(200), landing: "/../../etc/passwd" }),
    });
    const day = new Date().toISOString().slice(0, 10);
    const fb = async (p) => (await fetch(`http://127.0.0.1:${MOCK_FB_PORT}${p}.json`)).json();
    assertEq(await fb(`/analytics/daily/${day}/sources/Unknown/visits`), 1);
    const g = await fetch(`${DEV}/api/visit?source=google&type=Search&landing=/games`);
    assertEq(g.status, 204);
    assertEq(await fb(`/analytics/daily/${day}/sources/Google/visits`), 1);
    assertEq(await fb(`/analytics/daily/${day}/landing/~games/visits`), 1);
    const o = await fetch(`${DEV}/api/visit`, { method: "OPTIONS" });
    assertEq(o.status, 204);
  });
  suite("Update-check JSON API (/api/app-update) — future Android app contract");
  const upd = (qs) => fetch(`${DEV}/api/app-update?${qs}`);
  await test("CASE 1 installed 20 < latest 25 → updateAvailable true", async () => {
    const res = await upd("packageName=com.samva.calculator&versionCode=20");
    assertEq(res.status, 200);
    assertEq(res.headers.get("content-type").includes("application/json"), true);
    assertEq(res.headers.get("cache-control"), "no-store");
    assertEq(res.headers.get("access-control-allow-origin"), "*");
    const j = await res.json();
    assertEq(j.found, true);
    assertEq(j.latestVersionCode, 25);
    assertEq(j.installedVersionCode, 20);
    assertEq(j.updateAvailable, true);
    assertEq(j.downloadType, "direct");
    assert(String(j.downloadUrl).startsWith("https://"), "direct URL returned unproxied");
    assert(String(j.appUrl).includes("/app/"), "appUrl present");
  });
  await test("CASE 2 equal version → no update", async () => {
    const j = await (await upd("packageName=com.samva.calculator&versionCode=25")).json();
    assertEq(j.found, true);
    assertEq(j.updateAvailable, false);
    assertEq(j.reason, "up-to-date");
  });
  await test("CASE 3 installed newer → no false update", async () => {
    const j = await (await upd("packageName=com.samva.calculator&versionCode=30")).json();
    assertEq(j.found, true);
    assertEq(j.updateAvailable, false);
    assertEq(j.reason, "newer-installed");
  });
  await test("CASE 4 unknown package → found false", async () => {
    const j = await (await upd("packageName=com.example.unknown&versionCode=1")).json();
    assertEq(j.found, false);
    assertEq(j.updateAvailable, false);
    assertEq(j.reason, "not-listed");
  });
  await test("CASE 5 missing/invalid versionCode or package → safe 400 JSON", async () => {
    for (const qs of ["packageName=com.samva.calculator", "packageName=com.samva.calculator&versionCode=abc", "packageName=com.samva.calculator&versionCode=-3", "versionCode=5", "packageName=javascript:alert(1)&versionCode=1"]) {
      const res = await upd(qs);
      assertEq(res.status, 400, `400 for ${qs}`);
      const j = await res.json();
      assertEq(j.updateAvailable, undefined);
      assert(j.error, "error code present");
    }
  });
  await test("method + freshness + no SPA swallow", async () => {
    const post = await fetch(`${DEV}/api/app-update`, { method: "POST" });
    assertEq(post.status, 405);
    const get = await upd("packageName=com.samva.calculator&versionCode=1");
    assertEq(get.headers.get("cache-control"), "no-store");
    const body = await get.text();
    assert(!body.includes("<html"), "JSON only, never an HTML shell");
  });
} finally {
  dev.kill("SIGTERM");
  mockFb.close();
  await new Promise((r) => setTimeout(r, 200));
}

await summarize("Integration tests");
