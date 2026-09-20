// Mobile overflow diagnostics — real device emulation + offending-element report.
// Usage: node tools/mobile-diag.mjs [baseUrl]
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { FIXTURE_APPS } from "../tests/fixtures.mjs";
import { buildAppSlugIndex, getAppPath } from "../seo-utils.js";

const require = createRequire("/tmp/e2e/package.json");
const puppeteer = require("puppeteer");

const BASE = process.argv[2] || "";
let dev = null;
let base = BASE;
const MOCK_PORT = 8151;
const DEV_PORT = 8152;

if (!base) {
  const mockFb = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const p = new URL(req.url, "http://x").pathname;
    if (p === "/apps.json") return res.end(JSON.stringify(FIXTURE_APPS));
    res.end("null");
  });
  await mockFb.listen(MOCK_PORT, "127.0.0.1");
  dev = spawn(process.execPath, [path.join(process.cwd(), "tools/dev-server.mjs"), String(DEV_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(DEV_PORT), FIREBASE_DATABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, SHELL_BASE_URL: `http://127.0.0.1:${DEV_PORT}` },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 1200));
  base = `http://127.0.0.1:${DEV_PORT}`;
}

const apps = Object.entries(FIXTURE_APPS).map(([key, app]) => ({ key, ...app }));
const idx = buildAppSlugIndex(apps);
const gamePath = getAppPath(apps.find((a) => a.key === "-Test0002keyBBB"), idx);
const calcPath = getAppPath(apps.find((a) => a.key === "-Test0001keyAAA"), idx);

const DEVICES = [
  { name: "240x520 (zoomed-out viewport)", viewport: { width: 240, height: 520, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: "280x560 (narrow)", viewport: { width: 280, height: 560, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: "320x568 (iPhone SE1)", viewport: { width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: "360x780 (Pixel-like)", viewport: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 } },
  { name: "390x844 (iPhone 12)", viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: "430x932 (iPhone 15 PM)", viewport: { width: 430, height: 932, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: "568x320 (landscape SE)", viewport: { width: 568, height: 320, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: "844x390 (landscape 12)", viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
];
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

// Elements whose own horizontal scrolling is legitimate (internal scrollers).
const DIAG = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const LEGIT_SCROLLER = (el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowX);
  };
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const s = getComputedStyle(el);
    if (s.position === "fixed") return; // fixed boxes don't create page scroll overflow
    if (s.display === "none" || s.visibility === "hidden") return;
    const overRight = r.right > vw + 1;
    const overLeft = r.left < -1;
    if (!overRight && !overLeft) return;
    // skip elements inside a legitimate internal scroller
    let p = el.parentElement;
    let insideScroller = false;
    while (p && p !== document.body) {
      if (LEGIT_SCROLLER(p) || getComputedStyle(p).position === "fixed") { insideScroller = true; break; }
      p = p.parentElement;
    }
    if (insideScroller) return;
    if (el.classList.contains("skip-link")) return; // a11y offscreen pattern
    bad.push({
      sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
    });
  });
  return {
    vw,
    innerWidth: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    bodyClientW: document.body.clientWidth,
    offenders: bad.slice(0, 25),
    offenderCount: bad.length,
  };
};

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app 127.0.0.1, MAP api.ipify.org 127.0.0.1, MAP pl30953956.effectivecpmnetwork.com 127.0.0.1, MAP example.test 127.0.0.1, MAP cdn.example.test 127.0.0.1"],
});

const routes = process.env.LIVE_SLUGS
  ? [
      ["home", "/"],
      ["apps", "/apps"],
      ["detail-app", "/app/" + (process.env.LIVE_APP_SLUG || "kotha-bolbo")],
      ["detail-game", "/game/" + (process.env.LIVE_GAME_SLUG || "samva-online-tic-tac-toe")],
      ["auth", "/#auth"],
    ]
  : [
      ["home", "/"],
      ["apps", "/apps"],
      ["detail-app", calcPath],
      ["detail-game", gamePath],
      ["auth", "/#auth"],
    ];

const FONT_STANDARDS = [Number(process.env.FONT_STD || 16)];
if (process.env.FONT_ALL) FONT_STANDARDS.push(20, 24, 28);

for (const device of DEVICES) {
 for (const fontStd of FONT_STANDARDS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(MOBILE_UA);
  await page.setViewport(device.viewport);
  if (fontStd !== 16) {
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontStd, fixed: Math.round(fontStd * 0.85) } });
  }
  if (/127\.0\.0\.1/.test(base)) {
    await page.evaluateOnNewDocument((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, { samweb_cached_apps_v3: JSON.stringify(apps) });
  }
  for (const [label, route] of routes) {
    const url = base + route.replace("/#auth", "/");
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (route === "/#auth") await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    await page.waitForSelector("a.app-card, .app-detail-name, .auth-panel", { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const d = await page.evaluate(DIAG);
    const flag = d.docScrollW > d.vw + 1 || d.offenderCount > 0 ? "❌" : "✅";
    console.log(`${flag} ${device.name} font${fontStd} ${label}: vw=${d.vw} docScrollW=${d.docScrollW} bodyScrollW=${d.bodyScrollW} offenders=${d.offenderCount}`);
    for (const o of d.offenders.slice(0, 8)) console.log(`     ${o.sel}  left=${o.left} right=${o.right} w=${o.w} scrollW=${o.scrollW}/clientW=${o.clientW}`);
  }
  // screenshots at 360 for visual check
  if (device.viewport.width === 360) {
    fs.mkdirSync("/tmp/mshots", { recursive: true });
    for (const [label, route] of routes) {
      await page.goto(base + route.replace("/#auth", "/"), { waitUntil: "domcontentloaded" });
      if (route === "/#auth") await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: `/tmp/mshots/${label}-360.png` });
    }
  }
  await ctx.close();
 }
}

await browser.close();
if (dev) dev.kill();
process.exit(0);
