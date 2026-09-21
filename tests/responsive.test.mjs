// Responsive regression suite — real mobile emulation, overflow diagnostics that
// name the offending selector, SPA-navigation consistency, deep links, returning
// PWA client behaviour, admin panel matrix, and screenshot archive.
// Run: node tests/responsive.test.mjs
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { suite, test, assert, assertEq, assertIncludes, summarize } from "./harness.mjs";
import { FIXTURE_APPS, FIXTURE_ADMINS } from "./fixtures.mjs";
import { buildAppSlugIndex, getAppPath } from "../seo-utils.js";

const require = createRequire("/tmp/e2e/package.json");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = 8171;
const MOCK_FB_PORT = 8172;
const DEV = `http://127.0.0.1:${DEV_PORT}`;
const SHOTS = "/tmp/rshots";
fs.mkdirSync(SHOTS, { recursive: true });

const apps = Object.entries(FIXTURE_APPS).map(([key, app]) => ({ key, ...app }));
const idx = buildAppSlugIndex(apps);
const calcPath = getAppPath(apps.find((a) => a.key === "-Test0001keyAAA"), idx);
const gamePath = getAppPath(apps.find((a) => a.key === "-Test0002keyBBB"), idx);

const mockFb = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/apps.json") return res.end(JSON.stringify(FIXTURE_APPS));
  if (p === "/users.json") return res.end("{}");
  res.end("null");
});
const dev = spawn(process.execPath, [path.join(ROOT, "tools/dev-server.mjs"), String(DEV_PORT)], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(DEV_PORT), FIREBASE_DATABASE_URL: `http://127.0.0.1:${MOCK_FB_PORT}`, SHELL_BASE_URL: DEV },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer(base, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(base + "/")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Overflow diagnostics: returns page-level overflow + offending selectors. */
const DIAG = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const isScroller = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const s = getComputedStyle(el);
    if (s.position === "fixed" || s.display === "none" || s.visibility === "hidden") return;
    if (el.classList.contains("skip-link")) return;
    if (r.right <= vw + 1 && r.left >= -1) return;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      // contained by design: internal scroller, clipped carousel viewport, or off-canvas fixed shell
      if (isScroller(p) || ps.position === "fixed" || ps.overflowX === "hidden" || ps.overflowX === "clip") return;
      p = p.parentElement;
    }
    bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : ""}[right=${Math.round(r.right)}]`);
  });
  // Condition B guard: the shell must actually use the available width
  // (a shrink-wrapped "desktop canvas" passes overflow checks while looking tiny).
  let shellW = 0;
  for (const sel of [".site-header", ".container", ".page.active", ".admin-header", ".admin-container", "#adminDashboard"]) {
    const el = document.querySelector(sel);
    if (el) shellW = Math.max(shellW, Math.round(el.getBoundingClientRect().width));
  }
  if (!shellW) {
    for (const el of document.body.children) {
      if (getComputedStyle(el).position === "fixed") continue;
      shellW = Math.max(shellW, Math.round(el.getBoundingClientRect().width));
    }
  }
  return { vw, docScrollW: document.documentElement.scrollWidth, offenders: bad.slice(0, 12), shellW };
};

/** Desktop-layout detection on a phone viewport (§30). */
const MOBILE_STATE = () => {
  const vw = document.documentElement.clientWidth;
  const header = document.querySelector(".site-header");
  const login = document.getElementById("headerLoginBtn");
  const side = document.getElementById("sideNav");
  const hr = header ? header.getBoundingClientRect() : null;
  return {
    vw,
    headerWidth: hr ? Math.round(hr.width) : -1,
    headerHeight: hr ? Math.round(hr.height) : -1,
    loginHidden: !login || getComputedStyle(login).display === "none",
    sideMenuOffCanvas: !side || side.getBoundingClientRect().right <= 1,
    bodyScrollW: document.body.scrollWidth,
    docScrollW: document.documentElement.scrollWidth,
  };
};

await mockFb.listen(MOCK_FB_PORT, "127.0.0.1");
await waitForServer(DEV);
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--host-resolver-rules=MAP samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app 127.0.0.1, MAP api.ipify.org 127.0.0.1, MAP pl30953956.effectivecpmnetwork.com 127.0.0.1, MAP example.test 127.0.0.1, MAP cdn.example.test 127.0.0.1"],
});

async function mobilePage(width, height, fontStd = 16) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setUserAgent(MOBILE_UA);
  await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (fontStd !== 16) {
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontStd, fixed: Math.round(fontStd * 0.85) } });
  }
  await page.evaluateOnNewDocument((d) => { for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v); }, { samweb_cached_apps_v3: JSON.stringify(apps) });
  return { page, context };
}

async function assertNoOverflow(page, label) {
  const d = await page.evaluate(DIAG);
  assert(d.docScrollW <= d.vw + 1, `${label}: page scrollWidth ${d.docScrollW} > viewport ${d.vw} (${d.offenders.join(", ")})`);
  assertEq(d.offenders.length, 0, `${label}: offending elements → ${d.offenders.join(", ")}`);
  assert(d.shellW >= d.vw - 48, `${label}: shell too narrow (desktop-canvas symptom): shell ${d.shellW}px in ${d.vw}px viewport`);
}

const ROUTES = [
  ["home", "/"],
  ["apps", "/apps"],
  ["games", "/games"],
  ["search", "/search?q=calc"],
  ["detail-app", calcPath],
  ["detail-game", gamePath],
  ["signup", "/?auth=signup"],
  ["login", "/?auth=login"],
];

async function openRoute(page, route) {
  await page.goto(DEV + route.split("?")[0] + (route.includes("?auth=") ? "" : route.includes("?") ? route.slice(route.indexOf("?")) : ""), { waitUntil: "domcontentloaded" });
  if (route.endsWith("auth=signup")) await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
  if (route.endsWith("auth=login")) await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("login"); });
  await page.waitForSelector("a.app-card, .app-detail-name, .auth-panel, .not-found-block", { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 350));
}

try {
  // ============ VIEWPORT MATRIX (phones → desktop, portrait + landscape) ============
  suite("Responsive viewport matrix — no page overflow, offenders named");
  const WIDTHS = [
    [240, 520], [280, 560], [320, 568], [360, 640], [360, 780], [375, 667], [390, 844], [412, 915], [430, 932],
    [568, 320], [844, 390], [768, 1024], [1024, 768], [1280, 800], [1440, 900],
  ];
  for (const [w, h] of WIDTHS) {
    await test(`${w}x${h}: all public routes fit`, async () => {
      const { page, context } = await mobilePage(w, h);
      for (const [label, route] of ROUTES) {
        await openRoute(page, route);
        await assertNoOverflow(page, `${w}x${h} ${label}`);
      }
      await context.close();
    });
  }

  suite("Font-scale stress (Android text size / page zoom equivalence)");
  for (const font of [20, 24, 28]) {
    await test(`font ${font}px @ 240/320/360: key routes fit`, async () => {
      for (const [w, h] of [[240, 520], [320, 568], [360, 780]]) {
        const { page, context } = await mobilePage(w, h, font);
        for (const [label, route] of [["home", "/"], ["detail-app", calcPath], ["detail-game", gamePath], ["signup", "/?auth=signup"]]) {
          await openRoute(page, route);
          await assertNoOverflow(page, `font${font} ${w} ${label}`);
        }
        await context.close();
      }
    });
  }

  // ============ DESKTOP-LAYOUT DETECTION ON PHONE ============
  suite("Mobile state assertions (§30)");
  await test("360px: mobile nav state, hidden desktop controls, bounded header", async () => {
    const { page, context } = await mobilePage(360, 780);
    await openRoute(page, "/");
    const st = await page.evaluate(MOBILE_STATE);
    assert(st.loginHidden, "login button hidden on mobile");
    assert(st.sideMenuOffCanvas, "side menu off-canvas");
    assert(st.headerWidth <= st.vw + 1, `header width ${st.headerWidth} <= viewport`);
    assert(st.headerHeight <= 72, `header height ${st.headerHeight} compact`);
    assertEq(st.docScrollW, st.vw);
    await context.close();
  });

  // ============ SPA NAVIGATION CONSISTENCY (§57) ============
  suite("SPA router keeps mobile layout across navigation");
  await test("home → apps → detail → back → search → detail → home", async () => {
    const { page, context } = await mobilePage(360, 780);
    await openRoute(page, "/");
    await page.evaluate(() => window.navigateTo("/apps"));
    await new Promise((r) => setTimeout(r, 250));
    await assertNoOverflow(page, "spa apps");
    await page.click(`#appsPageGrid a.app-card[href="${calcPath}"]`);
    await page.waitForSelector(".app-detail-name", { timeout: 5000 });
    await assertNoOverflow(page, "spa detail");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 300));
    await assertNoOverflow(page, "spa back");
    await page.evaluate(() => window.navigateTo("/search?q=tic"));
    await new Promise((r) => setTimeout(r, 300));
    await assertNoOverflow(page, "spa search");
    await page.evaluate((gp) => window.navigateTo(gp), gamePath);
    await page.waitForSelector(".app-detail-name", { timeout: 5000 });
    await assertNoOverflow(page, "spa detail2");
    await page.evaluate(() => window.navigateTo("/"));
    await new Promise((r) => setTimeout(r, 300));
    await assertNoOverflow(page, "spa home");
    await context.close();
  });

  // ============ DEEP LINKS (cold, mobile) ============
  suite("Deep links on mobile (§58)");
  await test("cold /app/{slug} and /game/{slug} render fitted", async () => {
    for (const pth of [calcPath, gamePath]) {
      const { page, context } = await mobilePage(360, 780);
      await page.goto(DEV + pth, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".app-detail-name", { timeout: 10000 });
      await assertNoOverflow(page, `deep ${pth}`);
      const cssOk = await page.evaluate(() => !!document.querySelector('link[rel="stylesheet"]')?.sheet);
      assert(cssOk, "stylesheet applied on deep link");
      await context.close();
    }
  });

  // ============ PWA INSTALL POPUP COMPACTNESS ============
  suite("PWA install popup stays a compact floating card");
  await test("install card never becomes a full-width bottom bar (320/360/390/414)", async () => {
    for (const [w, h] of [[320, 568], [360, 640], [390, 844], [414, 896]]) {
      const { page, context } = await mobilePage(w, h);
      await openRoute(page, "/");
      const m = await page.evaluate(() => {
        const el = document.getElementById("installBanner");
        el.classList.remove("hidden");
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
      });
      assert(m.w <= Math.min(340, m.vw - 24) + 2, `${w}: install card compact (got ${m.w}px)`);
      assert(m.right <= m.vw, `${w}: card inside viewport`);
      assert(m.bottom <= m.vh, `${w}: card above viewport bottom`);
      await context.close();
    }
  });

  // ============ SCREENSHOT GALLERY CONTAINMENT (§19) ============
  suite("Screenshot rail scrolls internally only");
  await test("rail scrollWidth may exceed viewport but body must not", async () => {
    const { page, context } = await mobilePage(320, 568);
    await openRoute(page, gamePath);
    const m = await page.evaluate(() => ({
      rail: document.querySelector(".screenshots-scroll")?.scrollWidth || 0,
      body: document.body.scrollWidth,
      vw: document.documentElement.clientWidth,
    }));
    assert(m.rail > 0, "rail present");
    assert(m.body <= m.vw + 1, `body ${m.body} vs vw ${m.vw}`);
    await context.close();
  });

  // ============ RETURNING PWA CLIENT (§24/§59) ============
  suite("Service worker update lifecycle");
  await test("old v13 client adopts the new build on next visit (deploy transition)", async () => {
    const TMP = "/tmp/swtest";
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.cpSync(ROOT, TMP, { recursive: true });
    const currentSw = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8");
    const curStatic = (currentSw.match(/sayem-static-v\d+/) || [null])[0];
    const curRuntime = (currentSw.match(/sayem-runtime-v\d+/) || [null])[0];
    assert(curStatic && curRuntime, "cache names present");
    const oldStatic = curStatic + "-old";
    const oldRuntime = curRuntime + "-old";
    // simulate the previously deployed build: same logic, previous cache names
    fs.writeFileSync(path.join(TMP, "service-worker.js"), currentSw.split(curStatic).join(oldStatic).split(curRuntime).join(oldRuntime));
    const SW_PORT = 8173;
    const FB_PORT = 8174;
    const mock2 = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(FIXTURE_APPS)); });
    await mock2.listen(FB_PORT, "127.0.0.1");
    const dev2 = spawn(process.execPath, [path.join(TMP, "tools/dev-server.mjs"), String(SW_PORT)], {
      cwd: TMP,
      env: { ...process.env, PORT: String(SW_PORT), FIREBASE_DATABASE_URL: `http://127.0.0.1:${FB_PORT}`, SHELL_BASE_URL: `http://127.0.0.1:${SW_PORT}` },
      stdio: "ignore",
    });
    await waitForServer(`http://127.0.0.1:${SW_PORT}`);
    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(MOBILE_UA);
      await page.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.goto(`http://127.0.0.1:${SW_PORT}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(async (k) => (await caches.keys()).includes(k), { timeout: 15000 }, oldStatic);

      // ---- deploy happens: new SW (v14) + changed CSS ----
      fs.writeFileSync(path.join(TMP, "service-worker.js"), currentSw);
      fs.appendFileSync(path.join(TMP, "style.css"), "\n/* resp-marker-xyz */\n");
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(async (cur, old) => {
        const keys = await caches.keys();
        return keys.includes(cur) && !keys.includes(old);
      }, { timeout: 20000 }, curStatic, oldStatic);
      const css = await page.evaluate(async () => (await fetch("/style.css")).text());
      assertIncludes(css, "resp-marker-xyz", "returning client receives the new CSS");
      const adminCached = await page.evaluate(async () => !!(await caches.match(new Request("http://127.0.0.1:8173/admin"))));
      assert(!adminCached, "admin must never be SW-cached");
      await context.close();
    } finally {
      dev2.kill("SIGTERM");
      mock2.close();
    }
  });

  // ============ ADMIN PANEL MATRIX (§21/§64) ============
  suite("Admin panel responsive matrix");
  async function adminPage(width, height) {
    const { page, context } = await mobilePage(width, height);
    await page.goto(DEV + "/admin", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#adminUser", { timeout: 10000 });
    await page.evaluate(({ users, apps, admins }) => {
      const snap = (v) => ({ exists: () => v !== null && v !== undefined, val: () => v, size: v && typeof v === "object" ? Object.keys(v).length : 0, forEach: (cb) => { if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) if (cb({ key: k, val: () => val }) === true) break; } });
      const routes = [[/^admins$/, admins], [/^users$/, users], [/^apps$/, apps], [/^reports$/, {}], [/^visitors$/, {}], [/^adStats$/, { total: 3 }], [/^adminActivity$/, {}], [/^ads$/, {}], [/^settings\/adsInitialized$/, true], [/^settings\/adsMaxPerSlot$/, 2], [/^settings\/websiteName$/, null], [/^settings\/logoUrl$/, null], [/^settings\/apkDownloadLink$/, null], [/^apps\/(.+)$/, (m) => apps[m[1]] || null], [/^users\/(.+)$/, (m) => users[m[1]] || null]];
      window._ref = (db, p) => ({ path: String(p), toString: () => String(p) });
      window._get = (r) => { for (const [re, v] of routes) { const m = r.path.match(re); if (m) return Promise.resolve(snap(typeof v === "function" ? v(m) : v)); } return Promise.resolve(snap(null)); };
      window._push = (r) => ({ path: r.path + "/-x", key: "-x", toString: () => r.path + "/-x" });
      window._set = () => Promise.resolve(); window._update = () => Promise.resolve(); window._remove = () => Promise.resolve();
    }, { users: { "-U1": { name: "Very Long Username Example", email: "long.email.address.example@some-long-domain.example.com", number: "+8801700000001", password: "x", createdAt: Date.now(), acquisition: { firstTouch: { source: "some-very-long-referral-domain.example.net", sourceType: "Referral" }, latestTouch: { source: "Facebook" }, signup: { source: "Facebook", campaign: "an-extremely-long-campaign-name-for-testing" }, userSelectedSource: "Another website" } } }, apps: FIXTURE_APPS, admins: FIXTURE_ADMINS });
    await page.type("#adminUser", "testadmin");
    await page.type("#adminPass", "testpass123");
    await page.click("#btnLogin");
    await page.waitForFunction(() => document.getElementById("adminDashboard").style.display === "block", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 250));
    return { page, context };
  }
  for (const [w, h] of [[320, 568], [360, 780], [390, 844], [768, 1024], [1280, 800]]) {
    await test(`admin ${w}px: dashboard/users/traffic/add-app fit`, async () => {
      const { page, context } = await adminPage(w, h);
      for (const panel of ["usersList", "trafficPanel", "addApp", "appsList", "reportsPanel"]) {
        await page.evaluate((p) => showPanel(p), panel);
        await new Promise((r) => setTimeout(r, 250));
        await assertNoOverflow(page, `admin ${w} ${panel}`);
      }
      await context.close();
    });
  }
  await test("admin viewport meta is not zoom-locked", async () => {
    const { page, context } = await adminPage(360, 780);
    const vp = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
    assert(!/maximum-scale=1(\.0)?([,"]|$)/.test(vp) && !/user-scalable=no/.test(vp), `viewport lock: ${vp}`);
    assertIncludes(vp, "width=device-width");
    await context.close();
  });

  // ============ SCREENSHOT ARCHIVE (§64) ============
  suite("Screenshot archive for visual inspection");
  await test("captures 8 widths × key pages", async () => {
    for (const [w, h] of [[320, 568], [360, 780], [375, 667], [390, 844], [412, 915], [430, 932], [768, 1024], [1280, 800]]) {
      const { page, context } = await mobilePage(w, h);
      for (const [label, route] of [["home", "/"], ["apps", "/apps"], ["games", "/games"], ["search", "/search?q=calc"], ["detail", calcPath], ["signup", "/?auth=signup"], ["login", "/?auth=login"]]) {
        await openRoute(page, route);
        await page.screenshot({ path: `${SHOTS}/${label}-${w}.png` });
      }
      await context.close();
    }
    const { page, context } = await adminPage(360, 780);
    await page.screenshot({ path: `${SHOTS}/admin-360.png` });
    await context.close();
    assert(fs.readdirSync(SHOTS).length >= 50, "screenshot archive populated");
  });
} catch (err) {
  console.error("responsive suite fatal:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
  dev.kill("SIGTERM");
  mockFb.close();
}

await summarize("Responsive tests");
