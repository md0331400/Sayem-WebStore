// End-to-end browser tests (Puppeteer) against tools/dev-server.mjs.
//
// Safety: Chrome is launched with host-resolver rules that DEAD-END the real
// Firebase database, IP lookup and ad hosts, so no test can ever read or write
// production data. Apps come from a seeded localStorage cache; every Firebase
// write function is replaced by an in-page spy that records payloads.
//
// Run: node tests/e2e.test.mjs
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { suite, test, assert, assertEq, assertIncludes, assertNotIncludes, summarize } from "./harness.mjs";
import { FIXTURE_APPS, FIXTURE_USERS, FIXTURE_ADMINS, FIXTURE_ANALYTICS, fixtureAppsArray, NOW } from "./fixtures.mjs";
import { buildAppSlugIndex, getAppPath } from "../seo-utils.js";

const require = createRequire("/tmp/e2e/package.json");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = 8126;
const MOCK_FB_PORT = 8127;
const DEV = `http://127.0.0.1:${DEV_PORT}`;
const SHOTS = "/tmp/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const apps = fixtureAppsArray();
const slugIndex = buildAppSlugIndex(apps);
const calc = apps.find((a) => a.key === "-Test0001keyAAA");
const game = apps.find((a) => a.key === "-Test0002keyBBB");
const calcPath = getAppPath(calc, slugIndex);
const gamePath = getAppPath(game, slugIndex);

// ---------- servers ----------
const mockFb = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/apps.json") return res.end(JSON.stringify(FIXTURE_APPS));
  if (p === "/users.json") return res.end(JSON.stringify(FIXTURE_USERS));
  res.end("null");
});
const dev = spawn(process.execPath, [path.join(ROOT, "tools/dev-server.mjs"), String(DEV_PORT)], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(DEV_PORT), FIREBASE_DATABASE_URL: `http://127.0.0.1:${MOCK_FB_PORT}`, SHELL_BASE_URL: DEV },
  stdio: ["ignore", "pipe", "pipe"],
});
dev.stderr.on("data", (d) => process.env.DEBUG_TESTS && console.error("[dev]", String(d)));

async function waitForServer(base, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(base + "/")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

const BLOCKED_HOSTS = [
  "samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app",
  "api.ipify.org",
  "pl30953956.effectivecpmnetwork.com",
  "example.test",
  "cdn.example.test",
].map((h) => `MAP ${h} 127.0.0.1`).join(", ");

let browser;
async function newPage(seed = {}, referrer = null) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.evaluateOnNewDocument((data) => {
    try {
      for (const [k, v] of Object.entries(data)) window.localStorage.setItem(k, v);
    } catch {}
  }, seed);
  if (referrer !== null) {
    // Deterministic document.referrer before any page script runs.
    await page.evaluateOnNewDocument((ref) => {
      Object.defineProperty(document, "referrer", { get: () => ref, configurable: true });
    }, referrer);
  }
  page.on("pageerror", (e) => {
    if (!/Firebase|firebase|websocket|WebSocket|fetch/i.test(String(e.message))) {
      console.error("  [pageerror]", e.message);
    }
  });
  return { page, context };
}

const APP_CACHE_SEED = { samweb_cached_apps_v3: JSON.stringify(apps) };

/** Replaces all Firebase write/read helpers with recording spies (post module-eval). */
async function installSpies(page) {
  await page.evaluate(() => {
    window.__writes = [];
    window._createUserWithEmailAndPassword = (auth, email, pass) => Promise.resolve({ user: { uid: "-SpyAuthUid", email } });
    window._signInWithEmailAndPassword = (auth, email, pass) => Promise.resolve({ user: { uid: "-SpyAuthUid", email } });
    window.__txCount = 0;
    window._ref = (db, p) => ({ path: String(p), toString: () => String(p) });
    window._push = (r) => ({ path: `${r.path}/-SpyPush1`, key: "-SpyPush1", toString: () => `${r.path}/-SpyPush1` });
    window._set = (r, v) => {
      window.__writes.push({ op: "set", path: r.path, value: v });
      return Promise.resolve();
    };
    window._increment = (n) => ({ ".increment": n });
    window._update = (r, v) => {
      window.__writes.push({ op: "update", path: r.path, value: v });
      return Promise.resolve();
    };
    window._remove = (r) => {
      window.__writes.push({ op: "remove", path: r.path });
      return Promise.resolve();
    };
    window._runTransaction = (r, fn) => {
      window.__txCount += 1;
      try { fn({ downloads: 1 }); } catch {}
      return Promise.resolve();
    };
    window._get = (r) =>
      Promise.resolve({
        exists: () => false,
        val: () => null,
        size: 0,
        forEach: () => false,
      });
  });
}

async function readAttribution(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("sayemweb_attribution_v1") || "null");
    } catch {
      return "CORRUPT";
    }
  });
}

async function headMeta(page) {
  return page.evaluate(() => ({
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    description: document.querySelector('meta[name="description"]')?.content || "",
    robots: document.querySelector('meta[name="robots"]')?.content || "",
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
    ogUrl: document.querySelector('meta[property="og:url"]')?.content || "",
    ogImage: document.querySelector('meta[property="og:image"]')?.content || "",
    twTitle: document.querySelector('meta[name="twitter:title"]')?.content || "",
    twImage: document.querySelector('meta[name="twitter:image"]')?.content || "",
    jsonLd: document.getElementById("pageJsonLd")?.textContent || "",
    path: location.pathname + location.search,
  }));
}

async function fillSignup(page, { name = "Test User", email = "test-e2e@example.test", phone = "+8801711111111", pass = "secret123", source = null } = {}) {
  await page.evaluate(
    (v) => {
      document.getElementById("signName").value = v.name;
      document.getElementById("signEmail").value = v.email;
      document.getElementById("signPhone").value = v.phone;
      document.getElementById("signPass").value = v.pass;
      if (v.source !== null) document.getElementById("signSource").value = v.source;
    },
    { name, email, phone, pass, source }
  );
}

async function submitSignupAndGetUser(page, opts = {}) {
  await installSpies(page);
  await fillSignup(page, opts);
  await page.evaluate(() => window.doSignup());
  await new Promise((r) => setTimeout(r, 400));
  const writes = await page.evaluate(() => window.__writes.filter((w) => w.path.startsWith("users")));
  assert(writes.length >= 1, "signup should write a user record");
  return writes[writes.length - 1].value;
}

// ---------- boot ----------
await mockFb.listen(MOCK_FB_PORT, "127.0.0.1");
await waitForServer(DEV);
browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", `--host-resolver-rules=${BLOCKED_HOSTS}`],
});
console.log(`E2E against ${DEV} (firebase/ad hosts dead-ended; writes are spies)`);

try {
  // ============ HOMEPAGE ============
  await test("app cards have no View & Download CTA", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#appsGrid a.app-card", { timeout: 10000 });
    const ctaCount = await page.$$eval("#appsGrid .app-download-btn", (els) => els.length);
    assertEq(ctaCount, 0, "app cards have no extra CTA");
    await context.close();
  });

  await test("hero banner has swipe-only navigation", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#featureBanner .banner-slide", { timeout: 10000 });
    const controls = await page.$$eval("#featureBanner .banner-nav, #featureBanner .banner-dots", (els) => els.length);
    assertEq(controls, 0, "no manual slider controls");
    await context.close();
  });

  suite("Homepage & branding");
  await test("home renders Sayem WebStore with production SEO head", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    const meta = await headMeta(page);
    assertEq(meta.title, "Sayem WebStore — Free Apps & Games Download");
    assertEq(meta.canonical, "https://sayemwebstore.vercel.app/");
    assertIncludes(meta.description, "Sayem WebStore");
    assertEq(meta.ogUrl, "https://sayemwebstore.vercel.app/");
    assertIncludes(meta.jsonLd, '"WebSite"');
    assertIncludes(meta.jsonLd, '"Organization"');
    const brand = await page.$eval("#websiteName", (e) => e.textContent);
    assertEq(brand, "Sayem WebStore");
    const h1 = await page.$eval("h1", (e) => e.textContent);
    assert(h1.length > 5, "visible H1");
    const cards = await page.$$eval("#appsGrid a.app-card", (els) => els.map((e) => e.getAttribute("href")));
    assertEq(cards.length, apps.length, "home grid lists every app");
    assert(cards.every((h) => /^\/(app|game)\//.test(h)), "cards are crawlable app links");
    const latest = await page.$$eval("#latestGrid a.app-card", (e) => e.length);
    assert(latest > 0, "latest rail rendered");
    await page.screenshot({ path: `${SHOTS}/home-desktop.png` });
    await context.close();
  });

  await test("footer + side nav expose Apps/Games/legal links", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    const hrefs = await page.$$eval(".site-footer a.footer-link", (els) => els.map((e) => e.getAttribute("href")));
    for (const h of ["/", "/apps", "/games", "/search", "/faq", "/terms", "/privacy", "/disclaimer"]) {
      assert(hrefs.includes(h), `footer missing ${h}`);
    }
    await context.close();
  });

  // ============ CLIENT ROUTING + DYNAMIC META ============
  suite("Client router & dynamic metadata");
  await test("clicking a card navigates to /app/{slug} with full meta", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`a.app-card[href="${calcPath}"]`, { timeout: 10000 });
    await page.click(`a.app-card[href="${calcPath}"]`);
    await page.waitForSelector(".app-detail-name", { timeout: 5000 });
    const meta = await headMeta(page);
    assertEq(meta.path, calcPath);
    assertEq(meta.title, "Sam Calculator — Free App Download | Sayem WebStore");
    assertEq(meta.canonical, `https://sayemwebstore.vercel.app${calcPath}`);
    assertEq(meta.ogUrl, `https://sayemwebstore.vercel.app${calcPath}`);
    assertEq(meta.ogImage, calc.imageUrl);
    assertEq(meta.twImage, calc.imageUrl);
    assertIncludes(meta.jsonLd, '"SoftwareApplication"');
    assertIncludes(meta.jsonLd, '"BreadcrumbList"');
    const crumbs = await page.$$eval(".breadcrumbs a", (els) => els.map((e) => e.textContent));
    assertEq(crumbs.join(">"), "Home>Apps>Social");
    const info = await page.$eval(".app-info-table", (e) => e.textContent);
    assertIncludes(info, "2.5.1");
    assertIncludes(info, "com.samva.calculator");
    await page.screenshot({ path: `${SHOTS}/detail-desktop.png` });
    await context.close();
  });

  await test("direct deep-link to /game/{slug} resolves (spinner → content)", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + gamePath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-detail-name", { timeout: 10000 });
    const name = await page.$eval(".app-detail-name", (e) => e.textContent);
    assertEq(name, "Samva Online Tic Tac Toe");
    const meta = await headMeta(page);
    assertEq(meta.title, "Samva Online Tic Tac Toe — Free Game Download | Sayem WebStore");
    assertIncludes(meta.jsonLd, '"aggregateRating"');
    const reviews = await page.$eval(".reviews-list", (e) => e.textContent);
    assertIncludes(reviews, "Rahim");
    const crumbs = await page.$$eval(".breadcrumbs a", (els) => els.map((e) => e.textContent));
    assertEq(crumbs.join(">"), "Home>Games");
    await context.close();
  });

  await test("unknown /app/{slug} → Not Found view + noindex (never another app)", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/app/not-existing-xyz", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".not-found-block", { timeout: 10000 });
    const meta = await headMeta(page);
    assertEq(meta.robots, "noindex, follow");
    assertIncludes(meta.title, "Not Found");
    const text = await page.$eval(".not-found-block", (e) => e.textContent);
    assertNotIncludes(text, "Sam Calculator");
    const links = await page.$$eval(".not-found-actions a", (els) => els.map((e) => e.getAttribute("href")));
    assert(links.includes("/apps") && links.includes("/games") && links.includes("/"));
    await context.close();
  });

  await test("/apps and /games list routes + category param", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/apps", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#appsPageGrid a.app-card", { timeout: 10000 });
    let active = await page.$eval("#appsPage", (e) => e.classList.contains("active"));
    assert(active, "apps page active");
    const titles = await page.$$eval("#appsPageGrid .app-name", (els) => els.map((e) => e.textContent));
    assert(!titles.includes("Samva Online Tic Tac Toe"), "games excluded from /apps");

    await page.goto(DEV + "/games", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#gamesGrid a.app-card", { timeout: 10000 });
    const gTitles = await page.$$eval("#gamesGrid .app-name", (els) => els.map((e) => e.textContent));
    assertEq(gTitles.join(","), "Samva Online Tic Tac Toe");

    await page.goto(DEV + "/apps?category=Tools", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#appsPageGrid a.app-card", { timeout: 10000 });
    const tTitles = await page.$$eval("#appsPageGrid .app-name", (els) => els.map((e) => e.textContent));
    assert(tTitles.includes("CloudKeep Notebook") && !tTitles.includes("No Link App"), "category filter applied: " + tTitles);
    await context.close();
  });

  await test("/search?q= route renders results + noindex", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/search?q=calculator", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#searchResults a.app-card", { timeout: 10000 });
    const meta = await headMeta(page);
    assertEq(meta.robots, "noindex, follow");
    assertEq(meta.canonical, "https://sayemwebstore.vercel.app/search");
    const n = await page.$$eval("#searchResults a.app-card", (e) => e.length);
    assertEq(n, 2); // both Sam Calculator records
    await context.close();
  });

  await test("back button returns from detail to previous route", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/apps", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`#appsPageGrid a.app-card[href="${calcPath}"]`, { timeout: 10000, visible: true });
    await page.click(`#appsPageGrid a.app-card[href="${calcPath}"]`);
    await page.waitForSelector(".app-detail-name", { timeout: 5000 });
    await page.goBack({ waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 300));
    const active = await page.$eval("#appsPage", (e) => e.classList.contains("active"));
    assert(active, "back → /apps active");
    await context.close();
  });

  // ============ GUEST DOWNLOAD / GATED ACTIONS ============
  suite("Guest downloads & login-gated actions");
  await test("guest downloads: no login redirect + counter transaction fired", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + calcPath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".detail-actions a.btn-primary", { timeout: 10000 });
    const authVisibleBefore = await page.$eval("#authPage", (e) => e.classList.contains("active"));
    assert(!authVisibleBefore, "guest stays on the app page");
    await installSpies(page);
    await page.evaluate(() => {
      sessionStorage.setItem("__tx", "0");
      const orig = window._runTransaction;
      window._runTransaction = (r, fn) => {
        sessionStorage.setItem("__tx", String(Number(sessionStorage.getItem("__tx") || 0) + 1));
        return orig(r, fn);
      };
    });
    const handedOff = [];
    page.on("request", (r) => {
      if (r.url().includes("example.test/downloads")) handedOff.push(r.url());
    });
    const popups = [];
    browser.on("targetcreated", (t) => { if (t.type() === "page") popups.push(t.url()); });
    await page.evaluate(() => document.querySelector(".detail-actions a.btn-primary").scrollIntoView({ block: "center" }));
    const handoffWait = page.waitForRequest((r) => r.url().includes("example.test/downloads"), { timeout: 5000 });
    await page.click(".detail-actions a.btn-primary");
    await handoffWait;
    assertEq(handedOff.length, 1, "one same-tab hand-off toward the stored direct URL");
    assertEq(popups.length, 0, "no popup/new tab");
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForSelector(".detail-actions a.btn-primary", { timeout: 8000 });
    const tx = Number(await page.evaluate(() => sessionStorage.getItem("__tx")));
    assertEq(tx, 1, "counter transaction fired exactly once for guest");
    const stillNotAuth = await page.$eval("#authPage", (e) => e.classList.contains("active"));
    assert(!stillNotAuth, "no login redirect after download");
    await context.close();
  });

  await test("guest sees login gate instead of review form; reviews still readable", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + gamePath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".login-gate-card", { timeout: 10000 });
    const hasTextarea = await page.$("#reviewText");
    assert(!hasTextarea, "no review textarea for guests");
    const gateText = await page.$eval(".login-gate-card", (e) => e.textContent);
    assertIncludes(gateText, "no login needed");
    const reviewsVisible = await page.$eval(".reviews-list", (e) => e.textContent);
    assertIncludes(reviewsVisible, "Great game, no lag!");
    // login gate link → auth page
    await page.click(".login-gate-card a[data-auth-nav]");
    await new Promise((r) => setTimeout(r, 200));
    const authActive = await page.$eval("#authPage", (e) => e.classList.contains("active"));
    assert(authActive, "gate link opens auth page");
    await context.close();
  });

  await test("guest Report Us → clear login message, no anonymous report", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    await installSpies(page);
    await page.evaluate(() => window.openReport());
    await new Promise((r) => setTimeout(r, 200));
    const overlayHidden = await page.$eval("#reportOverlay", (e) => e.classList.contains("hidden"));
    assert(overlayHidden, "report modal not opened for guest");
    const authActive = await page.$eval("#authPage", (e) => e.classList.contains("active"));
    assert(authActive, "guest redirected to auth");
    const toastText = await page.$eval("#toast", (e) => e.textContent);
    assertIncludes(toastText, "login");
    const writes = await page.evaluate(() => window.__writes.filter((w) => w.path.startsWith("reports")));
    assertEq(writes.length, 0);
    await context.close();
  });

  await test("logged-in user gets review form (session restore)", async () => {
    const { page, context } = await newPage({
      ...APP_CACHE_SEED,
      samweb_user: JSON.stringify({ key: "u1", name: "Rahim", email: "rahim@example.test", number: "+8801700000009", password: "x", gender: "Male" }),
    });
    await page.goto(DEV + gamePath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#reviewText", { timeout: 10000 });
    const starsActive = await page.$$eval(".star.active", (e) => e.length);
    assertEq(starsActive, 5); // Rahim's existing 5-star review preloaded
    await context.close();
  });

  // ============ UPDATE CHECKER UI ============
  suite("Website update UI removed + direct same-tab download handoff");
  await test("?pkg=&vc= no longer triggers any update UI on the website", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(`${DEV}${calcPath}?pkg=com.samva.calculator&vc=10`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-detail-name", { timeout: 10000 });
    assert(!(await page.$(".update-banner")), "no update banner on website");
    const btnText = await page.$eval("#appDetailPageContent a[data-download-key]", (el) => el.textContent);
    assertIncludes(btnText, "Download Now");
    const target = await page.$eval("#appDetailPageContent a[data-download-key]", (el) => el.getAttribute("target"));
    assert(target === null, "download anchor must not open a new tab");
    await context.close();
  });
  await test("Download click: exactly one counter increment, same-tab hand-off, no popup tab", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    const popups = [];
    browser.on("targetcreated", (t) => { if (t.type() === "page") popups.push(t.url()); }); // ignore SW/worker targets
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${DEV}${calcPath}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#appDetailPageContent a[data-download-key]", { timeout: 10000 });
    await installSpies(page);
    // Mirror counter transactions into sessionStorage — it survives the
    // same-tab hand-off navigation, so exactly-once is assertable afterwards.
    await page.evaluate(() => {
      sessionStorage.setItem("__tx", "0");
      const orig = window._runTransaction;
      window._runTransaction = (r, fn) => {
        sessionStorage.setItem("__tx", String(Number(sessionStorage.getItem("__tx") || 0) + 1));
        return orig(r, fn);
      };
    });
    const link = await page.$eval("#appDetailPageContent a[data-download-key]", (el) => el.getAttribute("href"));
    const handoffWait = page.waitForRequest((r) => r.url() === link, { timeout: 5000 });
    await page.click("#appDetailPageContent a[data-download-key]");
    await handoffWait;
    assertEq(popups.length, 0, "no new tab/window opened");
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForSelector("#appDetailPageContent a[data-download-key]", { timeout: 8000 });
    const tx = Number(await page.evaluate(() => sessionStorage.getItem("__tx")));
    assertEq(tx, 1, `exactly one counter increment, got ${tx}`);
    assert(requests.some((u) => u === link), "browser handed off to the stored direct URL");
    await context.close();
  });
  await test("invalid stored URL disables the download button instead of navigating", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      window.handleDownloadClick(new Event("click"), "-Test0001keyAAA", "javascript:alert(1)");
    });
    const url = page.url();
    assert(url.startsWith(DEV), "no navigation to script URL");
    await context.close();
  });
  suite("Signup attribution (spec §65 Test A–F)");
  await test("Test A+D — Facebook UTM → internal navigation → signup keeps Facebook", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/?utm_source=facebook&utm_medium=social&utm_campaign=app_launch", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });

    // UTM stripped from the visible URL (canonical hygiene)
    const search = await page.evaluate(() => location.search);
    assertEq(search, "", "utm params stripped from URL");

    let attr = await readAttribution(page);
    assertEq(attr.firstTouch.source, "Facebook");
    assertEq(attr.firstTouch.sourceType, "Social");
    assertEq(attr.firstTouch.campaign, "app_launch");
    assertEq(attr.firstTouch.landingPage, "/");

    // internal navigation: home → apps → game detail (SPA clicks)
    await page.evaluate(() => window.navigateTo("/apps"));
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate((gp) => window.navigateTo(gp), gamePath);
    await new Promise((r) => setTimeout(r, 200));
    attr = await readAttribution(page);
    assertEq(attr.latestTouch.source, "Facebook", "internal navigation must NOT overwrite source");
    assertEq(attr.latestTouch.landingPage, "/", "landing page stays the acquisition page");

    // signup: preselect = Facebook, user changes answer to Friend → both stored
    await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    await new Promise((r) => setTimeout(r, 150));
    const preselect = await page.$eval("#signSource", (e) => e.value);
    assertEq(preselect, "Facebook", "signup question preselected from detection");

    const user = await submitSignupAndGetUser(page, { email: "testA@example.test", phone: "+8801700000101", source: "Friend / Someone shared it" });
    assertEq(user.acquisition.firstTouch.source, "Facebook");
    assertEq(user.acquisition.latestTouch.source, "Facebook");
    assertEq(user.acquisition.signup.source, "Facebook");
    assertEq(user.acquisition.signup.sourceType, "Social");
    assertEq(user.acquisition.signup.campaign, "app_launch");
    assertEq(user.acquisition.userSelectedSource, "Friend / Someone shared it");
    assertEq(user.signupSource, "Facebook", "denormalized signupSource = detected, not the answer");
    assertEq(user.acquisition.attributionVersion, 1);
    assert(Number(user.createdAt) > 0, "createdAt saved");
    await context.close();
  });

  await test("Test B — Google referrer → app landing page recorded", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED, "https://www.google.com/");
    await page.goto(DEV + calcPath, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-detail-name", { timeout: 15000 });
    const attr = await readAttribution(page);
    assertEq(attr.firstTouch.source, "Google");
    assertEq(attr.firstTouch.sourceType, "Search");
    assertEq(attr.firstTouch.landingPage, calcPath, "landing page = the app page they arrived on");
    await context.close();
  });

  await test("Test C — Google first, Facebook later → first=Google, latest=signup=Facebook", async () => {
    const dayAgo = NOW - 86400000;
    const { page, context } = await newPage({
      ...APP_CACHE_SEED,
      sayemweb_attribution_v1: JSON.stringify({
        version: 1,
        firstTouch: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: dayAgo, lastSeenAt: "" },
        latestTouch: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: "", lastSeenAt: dayAgo },
      }),
    });
    await page.goto(DEV + "/?utm_source=facebook&utm_medium=social&utm_campaign=relaunch", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    const attr = await readAttribution(page);
    assertEq(attr.firstTouch.source, "Google", "first touch immutable");
    assertEq(attr.latestTouch.source, "Facebook");
    assertEq(attr.latestTouch.campaign, "relaunch");

    await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    const user = await submitSignupAndGetUser(page, { email: "testC@example.test", phone: "+8801700000103", source: "" });
    assertEq(user.acquisition.firstTouch.source, "Google");
    assertEq(user.acquisition.latestTouch.source, "Facebook");
    assertEq(user.acquisition.signup.source, "Facebook", "signup attribution uses latest external touch");
    assertEq(user.acquisition.signup.campaign, "relaunch");
    await context.close();
  });

  await test("Test E — direct visit → Direct (never guessed as Google/Facebook)", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    const attr = await readAttribution(page);
    assertEq(attr.firstTouch.source, "Direct");
    assertEq(attr.latestTouch.source, "Direct");
    await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    const preselect = await page.$eval("#signSource", (e) => e.value);
    assertEq(preselect, "", "no dishonest preselect for direct traffic");
    const user = await submitSignupAndGetUser(page, { email: "testE@example.test", phone: "+8801700000105", source: "" });
    assertEq(user.acquisition.signup.source, "Direct");
    await context.close();
  });

  await test("social + referral + messaging referrers normalized", async () => {
    const cases = [
      ["https://l.facebook.com/l.php?u=x", "Facebook", "Social"],
      ["https://www.tiktok.com/@someone", "TikTok", "Social"],
      ["https://web.whatsapp.com/", "WhatsApp", "Messaging"],
      ["https://some-random-blog.net/post?private=1", "some-random-blog.net", "Referral"],
    ];
    for (const [referer, source, type] of cases) {
      const { page, context } = await newPage(APP_CACHE_SEED, referer);
      await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("a.app-card", { timeout: 10000 });
      const attr = await readAttribution(page);
      assertEq(attr.firstTouch.source, source, referer);
      assertEq(attr.firstTouch.sourceType, type, referer);
      assertNotIncludes(JSON.stringify(attr), "private=1");
      await context.close();
    }
  });

  await test("internal referrer does not create attribution", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED, DEV + "/");
    await page.goto(DEV + "/apps", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#appsPageGrid a.app-card", { timeout: 10000 });
    const attr = await readAttribution(page);
    assertEq(attr.firstTouch.source, "Direct", "own-site referrer → Direct, not '127.0.0.1'");
    await context.close();
  });

  await test("§50 — corrupted attribution storage never blocks signup", async () => {
    const { page, context } = await newPage({ ...APP_CACHE_SEED, sayemweb_attribution_v1: "{{{not-json!!" });
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    const user = await submitSignupAndGetUser(page, { email: "testX@example.test", phone: "+8801700000107", source: "Other" });
    assertEq(user.acquisition.signup.source, "Direct", "falls back safely");
    assertEq(user.acquisition.userSelectedSource, "Other");
    await context.close();
  });

  // ============ RESPONSIVE ============
  suite("Responsive layout (no horizontal overflow)");
  for (const [w, h, label] of [[360, 780, "mobile"], [768, 1024, "tablet"], [1280, 900, "desktop"]]) {
    await test(`${label} ${w}x${h}: home + detail + auth fit viewport`, async () => {
      const { page, context } = await newPage(APP_CACHE_SEED);
      await page.setViewport({ width: w, height: h });
      for (const [url, waitSel] of [[DEV + "/", "a.app-card"], [DEV + gamePath, ".app-detail-name"], [DEV + calcPath, ".app-detail-name"]]) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(waitSel, { timeout: 15000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 1, `${url} overflows by ${overflow}px at ${label}`);
      }
      await page.goto(DEV + gamePath, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".app-detail-name", { timeout: 15000 });
      await page.screenshot({ path: `${SHOTS}/detail-${label}.png`, fullPage: false });
      await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("a.app-card", { timeout: 15000 });
      await page.screenshot({ path: `${SHOTS}/home-${label}.png` });
      await context.close();
    });
  }

  // ============ PWA ============
  suite("PWA preservation");
  await test("service worker registers; manifest is Sayem WebStore", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    const swOk = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await navigator.serviceWorker.getRegistration("./");
      return !!reg;
    });
    assert(swOk === true || swOk === "unsupported", "SW registered");
    const manifest = await page.evaluate(async () => (await (await fetch("/manifest.json")).json()));
    assertEq(manifest.name, "Sayem WebStore");
    assertEq(manifest.start_url, "./");
    await context.close();
  });

  // ============ ADMIN PANEL ============
  suite("Admin panel — users, sources, campaigns, traffic analytics");

  const FIXTURE_REPORTS = {
    "-Rep1": { username: "Rahim", email: "rahim@example.test", subject: "Broken link", message: "Download 404s", timestamp: NOW - 3600000, type: "report_us", source: "report_us" },
  };

  async function openAdmin() {
    const { page, context } = await newPage({});
    await page.goto(DEV + "/admin", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#adminUser", { timeout: 10000 });
    await page.evaluate(
      ({ users, apps, admins, reports, analytics }) => {
        const snap = (value) => ({
          exists: () => value !== null && value !== undefined,
          val: () => value,
          size: value && typeof value === "object" ? Object.keys(value).length : 0,
          forEach: (cb) => {
            if (value && typeof value === "object") {
              for (const [k, v] of Object.entries(value)) if (cb({ key: k, val: () => v }) === true) break;
            }
          },
        });
        const routes = [
          [/^admins$/, admins],
          [/^users$/, users],
          [/^apps$/, apps],
          [/^reports$/, reports],
          [/^visitors$/, {}],
          [/^adStats$/, { total: 7, daily: {}, perAd: {}, perSlot: {} }],
          [/^adminActivity$/, {}],
          [/^analytics$/, analytics],
          [/^ads$/, {}],
          [/^settings\/adsInitialized$/, true],
          [/^settings\/adsMaxPerSlot$/, 2],
          [/^settings\/websiteName$/, null],
          [/^settings\/logoUrl$/, null],
          [/^settings\/apkDownloadLink$/, null],
          [/^apps\/(.+)$/, (m) => apps[m[1]] || null],
          [/^users\/(.+)$/, (m) => users[m[1]] || null],
        ];
        window.__adminWrites = [];
        window._ref = (db, p) => ({ path: String(p), toString: () => String(p) });
        window._get = (r) => {
          for (const [re, value] of routes) {
            const m = r.path.match(re);
            if (m) return Promise.resolve(snap(typeof value === "function" ? value(m) : value));
          }
          return Promise.resolve(snap(null));
        };
        window._push = (r) => ({ path: `${r.path}/-AdminSpy1`, key: "-AdminSpy1", toString: () => `${r.path}/-AdminSpy1` });
        window._set = (r, v) => { window.__adminWrites.push({ op: "set", path: r.path, value: v }); return Promise.resolve(); };
        window._update = (r, v) => { window.__adminWrites.push({ op: "update", path: r.path, value: v }); return Promise.resolve(); };
        window._increment = (n) => ({ ".increment": n });
        window._remove = (r) => { window.__adminWrites.push({ op: "remove", path: r.path }); return Promise.resolve(); };
      },
      { users: FIXTURE_USERS, apps: FIXTURE_APPS, admins: FIXTURE_ADMINS, reports: FIXTURE_REPORTS, analytics: FIXTURE_ANALYTICS }
    );
    await page.type("#adminUser", "testadmin");
    await page.type("#adminPass", "testpass123");
    await page.click("#btnLogin");
    await page.waitForFunction(() => document.getElementById("adminDashboard").style.display === "block", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    return { page, context };
  }

  await test("admin login + dashboard stats (legacy functions intact)", async () => {
    const { page, context } = await openAdmin();
    const users = await page.$eval("#totalUsers", (e) => e.textContent);
    assertEq(users, "4");
    const appsCount = await page.$eval("#totalApps", (e) => e.textContent);
    assertEq(appsCount, "5");
    await context.close();
  });

  await test("users list: Source + Campaign + Signup Date columns", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("usersList"));
    await page.waitForSelector(".user-row", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    const rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    assertEq(rows.length, 4);
    const ayesha = rows.find((r) => r.includes("Ayesha"));
    assertIncludes(ayesha, "Facebook");
    assertIncludes(ayesha, "app_launch");
    const legacy = rows.find((r) => r.includes("Legacy"));
    assertIncludes(legacy, "no data");
    await page.screenshot({ path: `${SHOTS}/admin-users.png` });
    await context.close();
  });

  await test("user search + source filter + campaign filter work together", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("usersList"));
    await page.waitForSelector(".user-row", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 150));

    await page.evaluate(() => {
      const el = document.getElementById("userSourceFilter");
      el.value = "Facebook";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    let rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent));
    assertEq(rows.length, 1);
    assertIncludes(rows[0], "Ayesha");

    await page.evaluate(() => {
      document.getElementById("userSourceFilter").value = "";
      document.getElementById("userSourceFilter").dispatchEvent(new Event("change", { bubbles: true }));
      const q = document.getElementById("userSearchInput");
      q.value = "rakib";
      q.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 400)); // debounce 180ms
    rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent));
    assertEq(rows.length, 1);
    assertIncludes(rows[0], "Rakib");

    // search + source combined
    await page.evaluate(() => {
      const q = document.getElementById("userSearchInput");
      q.value = "";
      q.dispatchEvent(new Event("input", { bubbles: true }));
      const sel = document.getElementById("userCampaignFilter");
      sel.value = "eid2026";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 400));
    rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent));
    assertEq(rows.length, 1);
    assertIncludes(rows[0], "Dana");

    // legacy bucket filter
    await page.evaluate(() => {
      document.getElementById("userCampaignFilter").value = "";
      document.getElementById("userCampaignFilter").dispatchEvent(new Event("change", { bubbles: true }));
      const sel = document.getElementById("userSourceFilter");
      sel.value = "__none__";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent));
    assertEq(rows.length, 1);
    assertIncludes(rows[0], "Legacy");

    // clear filters
    await page.click("#btnClearUserFilters");
    await new Promise((r) => setTimeout(r, 200));
    rows = await page.$$(".user-row");
    assertEq(rows.length, 4);
    await context.close();
  });

  await test("user detail shows full acquisition information (§40)", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("usersList"));
    await page.waitForSelector(".user-row", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => document.getElementById("viewUserBtn_-User0001aaaa").click());
    await page.waitForSelector("#userDetailOverlay:not(.hidden)", { timeout: 3000 });
    const text = await page.$eval("#userDetailContent", (e) => e.textContent.replace(/\s+/g, " "));
    for (const needle of ["Detected Source", "Facebook", "Social", "app_launch", "First Touch", "Google", "Latest Touch", "Signup Landing Page", "Signup Time", "Friend / Someone shared it"]) {
      assertIncludes(text, needle);
    }
    await page.screenshot({ path: `${SHOTS}/admin-user-detail.png` });
    await context.close();
  });

  await test("legacy user detail: graceful 'no acquisition data'", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("usersList"));
    await page.waitForSelector(".user-row", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".user-row")];
      const legacyRow = rows.find((r) => r.textContent.includes("Legacy"));
      legacyRow.querySelector('[id^="viewUserBtn_"]').click();
    });
    await page.waitForSelector("#userDetailOverlay:not(.hidden)", { timeout: 3000 });
    const text = await page.$eval("#userDetailContent", (e) => e.textContent);
    assertIncludes(text, "before source tracking");
    assertIncludes(text, "Legacy User");
    await context.close();
  });

  await test("traffic dashboard: stats, source table, campaign table, date ranges (§43–46)", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("trafficPanel"));
    await page.waitForSelector("#trafficStatsGrid .stat-card", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 200));

    // default range: Last 30 Days → Ayesha(2d,FB) Rakib(20d,Google) Dana(1d,TikTok); legacy(60d) out of range
    let stats = await page.$$eval("#trafficStatsGrid .stat-card", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    const get = (label) => Number((stats.find((s) => s.includes(label)) || "0").split(" ")[0]);
    assertEq(get("Attributed Signups"), 3);
    assertEq(get("Facebook"), 1);
    assertEq(get("Google"), 1);
    assertEq(get("TikTok"), 1);

    let srcRows = await page.$$eval("#trafficSourceTable .traffic-row", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    assertEq(srcRows.length, 3);
    for (const s of ["Facebook", "Google", "TikTok"]) assert(srcRows.some((r) => r.includes(s)), `source row ${s}`);

    let campRows = await page.$$eval("#trafficCampaignTable .traffic-row", (els) => els.map((e) => e.textContent));
    assert(campRows.some((r) => r.includes("app_launch")));
    assert(campRows.some((r) => r.includes("eid2026")));

    let ansRows = await page.$$eval("#trafficAnswerTable tr", (els) => els.map((e) => e.textContent));
    assert(ansRows.some((r) => r.includes("Friend / Someone shared it")));

    // switch to All Time → legacy bucket appears
    await page.evaluate(() => {
      const sel = document.getElementById("trafficRangeSelect");
      sel.value = "all";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    stats = await page.$$eval("#trafficStatsGrid .stat-card", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    const getAll = (label) => Number((stats.find((s) => s.includes(label)) || "0").split(" ")[0]);
    assertEq(getAll("Legacy (no data)"), 1);

    // Yesterday → exactly Dana's TikTok signup (created NOW-24h)
    await page.evaluate(() => {
      const sel = document.getElementById("trafficRangeSelect");
      sel.value = "yesterday";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    stats = await page.$$eval("#trafficStatsGrid .stat-card", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
    const getY = (label) => Number((stats.find((s) => s.includes(label)) || "0").split(" ")[0]);
    assertEq(getY("Attributed Signups"), 1);
    assertEq(getY("TikTok"), 1);
    assertEq(getY("Facebook"), 0);

    await page.evaluate(() => {
      const sel = document.getElementById("trafficRangeSelect");
      sel.value = "30d";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: `${SHOTS}/admin-traffic.png`, fullPage: true });
    await context.close();
  });

  await test("§45 — clicking a source row shows that source's users (reuses Users tab)", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("trafficPanel"));
    await page.waitForSelector("#trafficSourceTable .traffic-row", { timeout: 5000 });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("#trafficSourceTable .traffic-row")].find((r) => r.textContent.includes("TikTok"));
      row.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const panelVisible = await page.$eval("#usersList", (e) => e.classList.contains("active"));
    assert(panelVisible, "users panel opened");
    const selVal = await page.$eval("#userSourceFilter", (e) => e.value);
    assertEq(selVal, "TikTok");
    const rows = await page.$$eval(".user-row", (els) => els.map((e) => e.textContent));
    assertEq(rows.length, 1);
    assertIncludes(rows[0], "Dana");
    // admin can open the profile
    await page.evaluate(() => document.querySelector('[id^="viewUserBtn_"]').click());
    await page.waitForSelector("#userDetailOverlay:not(.hidden)", { timeout: 3000 });
    const text = await page.$eval("#userDetailContent", (e) => e.textContent);
    assertIncludes(text, "TikTok");
    await context.close();
  });

  await test("§47 — campaign link generator builds + validates URLs", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("trafficPanel"));
    await page.waitForSelector("#genSource", { timeout: 5000 });

    await page.evaluate(() => {
      document.getElementById("genDest").value = "/games";
      document.getElementById("genSource").value = "TikTok";
      document.getElementById("genMedium").value = "Social";
      document.getElementById("genCampaign").value = "Eid 2026 Promo";
      document.getElementById("genSource").dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.click("#btnGenerateCampaignLink");
    await new Promise((r) => setTimeout(r, 150));
    let out = await page.$eval("#genLinkOutput", (e) => e.textContent);
    assertEq(out, "https://sayemwebstore.vercel.app/games?utm_source=tiktok&utm_medium=social&utm_campaign=eid_2026_promo");

    // invalid external destination rejected
    await page.evaluate(() => {
      document.getElementById("genDest").value = "https://evil.example.com/x";
      document.getElementById("genDest").dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    out = await page.$eval("#genLinkOutput", (e) => e.textContent);
    assertIncludes(out, "sayemwebstore.vercel.app");
    assertNotIncludes(out, "evil.example.com/?utm");
    await context.close();
  });

  await test("§18/§20 — Add App & Edit App carry version fields (old records compatible)", async () => {
    const { page, context } = await openAdmin();
    // Add App form has the fields
    await page.evaluate(() => showPanel("addApp"));
    for (const id of ["aVersionName", "aVersionCode", "aPackageName"]) {
      assert(await page.$("#" + id), `${id} exists`);
    }
    // Fill + add → capture the write
    await page.evaluate(() => {
      document.getElementById("aName").value = "E2E Test App";
      document.getElementById("aDesc").value = "Added by E2E test";
      document.getElementById("aVersionName").value = "1.2.3";
      document.getElementById("aVersionCode").value = "12";
      document.getElementById("aPackageName").value = "com.e2e.testapp";
      document.getElementById("btnAddApp").click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const writes = await page.evaluate(() => window.__adminWrites.filter((w) => w.path.startsWith("apps")));
    assert(writes.length >= 1, "app write captured");
    const appWrite = writes[0].value;
    assertEq(appWrite.versionName, "1.2.3");
    assertEq(appWrite.versionCode, 12);
    assertEq(appWrite.packageName, "com.e2e.testapp");
    assert(Number(appWrite.createdAt) > 0);

    // invalid version code rejected (refill required fields — form resets after success)
    await page.evaluate(() => {
      document.getElementById("aName").value = "E2E Test App 2";
      document.getElementById("aDesc").value = "Should be rejected";
      document.getElementById("aVersionCode").value = "1.5";
      document.getElementById("btnAddApp").click();
    });
    await new Promise((r) => setTimeout(r, 200));
    const toastText = await page.$eval("#toast", (e) => e.textContent);
    assertIncludes(toastText, "whole number");
    const writesAfterBad = await page.evaluate(() => window.__adminWrites.filter((w) => w.path.startsWith("apps")).length);
    assertEq(writesAfterBad, 1, "invalid version code must not write");

    // Edit modal prefills version fields from the record
    await page.evaluate(() => openEditApp("-Test0001keyAAA"));
    await page.waitForSelector("#editAppOverlay:not(.hidden)", { timeout: 3000 });
    const vals = await page.evaluate(() => ({
      vn: document.getElementById("editVersionName").value,
      vc: document.getElementById("editVersionCode").value,
      pkg: document.getElementById("editPackageName").value,
    }));
    assertEq(vals.vn, "2.5.1");
    assertEq(vals.vc, "25");
    assertEq(vals.pkg, "com.samva.calculator");

    // legacy record → empty fields, still editable
    await page.evaluate(() => { closeModal("editAppOverlay"); openEditApp("-Test0003keyCCC"); });
    await new Promise((r) => setTimeout(r, 200));
    const legacyVals = await page.evaluate(() => ({
      vn: document.getElementById("editVersionName").value,
      vc: document.getElementById("editVersionCode").value,
      pkg: document.getElementById("editPackageName").value,
    }));
    assertEq(legacyVals.vn + legacyVals.vc + legacyVals.pkg, "");
    await context.close();
  });

  await test("apps list shows version info; existing panels still work", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("appsList"));
    await new Promise((r) => setTimeout(r, 300));
    const listText = await page.$eval("#adminAppsList", (e) => e.textContent.replace(/\s+/g, " "));
    assertIncludes(listText, "v2.5.1 (code 25)");
    assertIncludes(listText, "com.samva.calculator");
    assertIncludes(listText, "no version info");
    // reports panel intact
    await page.evaluate(() => showPanel("reportsPanel"));
    await new Promise((r) => setTimeout(r, 300));
    const reportsText = await page.$eval("#adminReportsList", (e) => e.textContent);
    assertIncludes(reportsText, "Broken link");
    await context.close();
  });
  suite("Anonymous aggregate analytics (client side)");
  await test("visit beacon fires once per browser session", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    const visits = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/visit") && r.method() === "POST") visits.push(r.postData());
    });
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    await page.evaluate(() => window.navigateTo("/apps"));
    await new Promise((r) => setTimeout(r, 400));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 600));
    assertEq(visits.length, 1, `exactly one beacon per session, got ${visits.length}`);
    const payload = JSON.parse(visits[0]);
    assertEq(payload.source, "Direct");
    assertEq(payload.landing, "/");
    assert(!("ip" in payload) && !("ua" in payload) && !("id" in payload), "payload carries no identity fields");
    await context.close();
  });
  await test("signup writes one aggregate signup increment for its source", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED, "https://m.facebook.com/");
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.app-card", { timeout: 10000 });
    await installSpies(page);
    await page.evaluate(() => { window.showPage("authPage"); window.switchAuth("signup"); });
    await page.type("#signName", "Aggregate Test");
    await page.type("#signEmail", "agg@test.example.com");
    await page.type("#signPhone", "+8801799999999");
    await page.type("#signPass", "secret123");
    await page.evaluate(() => window.doSignup());
    await page.waitForFunction(() => window.__writes.some((w) => w.path.startsWith("users/")), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    const writes = await page.evaluate(() => window.__writes);
    const day = new Date().toISOString().slice(0, 10);
    const agg = writes.filter((w) => w.path === `analytics/daily/${day}/sources/Facebook/signups`);
    assertEq(agg.length, 1, "one aggregate signup increment for Facebook");
    assertEq(agg[0].op, "update");
    assertEq(agg[0].value[".increment"], 1);
    await context.close();
  });
  suite("Public copy honesty");
  await test("no fabricated 'verified download' claims; privacy matches reality", async () => {
    const { page, context } = await newPage(APP_CACHE_SEED);
    await page.goto(DEV + "/", { waitUntil: "domcontentloaded" });
    const home = await page.evaluate(() => document.body.innerText);
    assert(!/verified and served/i.test(home), "fabricated verification claim removed");
    assertIncludes(home, "Direct Publisher Links");
    await page.evaluate(() => window.navigateTo("/privacy"));
    await new Promise((r) => setTimeout(r, 250));
    const priv = await page.evaluate(() => document.getElementById("privacyPage").innerText);
    assertIncludes(priv, "no IP address");
    assertIncludes(priv, "once per browser session");
    assertIncludes(priv, "Legacy Visit Records");
    await page.evaluate(() => window.navigateTo("/terms"));
    await new Promise((r) => setTimeout(r, 250));
    const terms = await page.evaluate(() => document.getElementById("termsPage").innerText);
    assertIncludes(terms, "Analytics & Attribution");
    await page.evaluate(() => window.navigateTo("/faq"));
    await new Promise((r) => setTimeout(r, 250));
    const faq = await page.evaluate(() => document.getElementById("faqPage").innerText);
    assertIncludes(faq, "publisher's own download");
    await context.close();
  });
  suite("Admin conversion + landing aggregates");
  await test("traffic panel renders visitor-to-signup conversion and landing tables", async () => {
    const { page, context } = await openAdmin();
    await page.evaluate(() => showPanel("trafficPanel"));
    await page.waitForSelector("#trafficConvTable table", { timeout: 5000 });
    const conv = await page.$eval("#trafficConvTable", (el) => el.textContent);
    assertIncludes(conv, "Facebook");
    assertIncludes(conv, "Visitors");
    const land = await page.$eval("#trafficLandingTable", (el) => el.textContent);
    assertIncludes(land, "/app/kotha-bolbo");
    await page.select("#trafficRangeSelect", "yesterday");
    await new Promise((r) => setTimeout(r, 400));
    const landY = await page.$eval("#trafficLandingTable", (el) => el.textContent);
    assertIncludes(landY, "/game/samva-online-tic-tac-toe");
    await context.close();
  });
} catch (err) {
  console.error("E2E fatal:", err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  dev.kill("SIGTERM");
  mockFb.close();
}

await summarize("E2E tests");
