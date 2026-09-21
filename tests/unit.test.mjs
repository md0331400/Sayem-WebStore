// Unit tests — pure logic: slugs, ratings, update checker, attribution, sitemap, JSON-LD, renderers.
// Run: node tests/unit.test.mjs
import { suite, test, assert, assertEq, assertIncludes, assertNotIncludes, summarize } from "./harness.mjs";
import {
  slugify,
  buildAppSlugIndex,
  getAppPath,
  isGameApp,
  getAverageRating,
  getReviewCount,
  resolveUpdateStatus,
  isSafeDownloadUrl,
  buildAppViewModel,
  renderAppDetailInner,
  renderNotFoundInner,
  appCardHtml,
  buildSitemapXml,
  homeJsonLd,
  appJsonLd,
  escapeHtml,
  truncateText,
} from "../seo-utils.js";
import {
  classifyVisit,
  applyVisit,
  buildSignupAttribution,
  sanitizeState,
  defaultState,
  mapDetectedToSignupOption,
  stripUtmFromSearch,
  prettifyUtmSource,
  ATTRIBUTION_TTL_DAYS,
} from "../attribution.js";
import { fixtureAppsArray, FIXTURE_APPS, NOW } from "./fixtures.mjs";

const apps = fixtureAppsArray();
const index = buildAppSlugIndex(apps);
const DAY = 86400000;

// ============ SLUGS ============
suite("Slugs & routing paths");
test("slugify basic", () => assertEq(slugify("Sam Calculator"), "sam-calculator"));
test("slugify strips punctuation", () => assertEq(slugify("Hello — World!! (Beta)"), "hello-world-beta"));
test("slugify accents", () => assertEq(slugify("Café App"), "cafe-app"));
test("slugify non-latin falls back to key", () => assertEq(slugify("অ্যাপ স্টোর", "-Abc123XYZ"), "app-123xyz"));
test("duplicate names get unique deterministic slugs", () => {
  const dupes = apps.filter((a) => a.name === "Sam Calculator");
  assertEq(dupes.length, 2);
  const [s1, s2] = dupes.map((a) => index.byKey.get(a.key));
  assert(s1 !== s2, "collision slugs must differ");
  assert(s1.startsWith("sam-calculator-"), `expected suffixed slug, got ${s1}`);
  assertEq(index.bySlug.get(s1), dupes[0].key);
  assertEq(index.bySlug.get(s2), dupes[1].key);
});
test("slug index is order-independent", () => {
  const reversed = buildAppSlugIndex([...apps].reverse());
  for (const app of apps) assertEq(reversed.byKey.get(app.key), index.byKey.get(app.key));
});
test("games route to /game/, others to /app/", () => {
  const game = apps.find(isGameApp);
  assert(getAppPath(game, index).startsWith("/game/"), "game path");
  const tool = apps.find((a) => a.category === "Tools");
  assert(getAppPath(tool, index).startsWith("/app/"), "app path");
});
test("unique-name app keeps clean slug", () => {
  const game = apps.find((a) => a.key === "-Test0002keyBBB");
  assertEq(getAppPath(game, index), "/game/samva-online-tic-tac-toe");
});

// ============ RATINGS (honest) ============
suite("Ratings — never fabricated");
test("no reviews + rating 0 → null (not 4.5)", () => {
  const legacy = apps.find((a) => a.key === "-Test0003keyCCC");
  assertEq(getAverageRating(legacy), null);
});
test("real reviews average", () => {
  const game = apps.find((a) => a.key === "-Test0002keyBBB");
  assertEq(getAverageRating(game), 4.5);
  assertEq(getReviewCount(game), 2);
});
test("legacy positive rating field honoured", () => {
  assertEq(getAverageRating({ rating: 4 }), 4);
});

// ============ UPDATE CHECKER (§69 matrix) ============
suite("Update checker");
test("installed 10, website 11 → update prompt", () => {
  const r = resolveUpdateStatus(10, 11);
  assert(r.updateAvailable);
  assertEq(r.reason, "update");
});
test("installed 11, website 11 → no update", () => {
  const r = resolveUpdateStatus(11, 11);
  assert(!r.updateAvailable);
  assertEq(r.reason, "up-to-date");
});
test("installed 12, website 11 → no false update", () => {
  const r = resolveUpdateStatus(12, 11);
  assert(!r.updateAvailable);
  assertEq(r.reason, "newer-installed");
});
test("missing versionCode → no crash, no update", () => {
  for (const [a, b] of [[10, undefined], [undefined, 11], [null, null], ["x", "y"], [10, 0], [10, null]]) {
    const r = resolveUpdateStatus(a, b);
    assert(!r.updateAvailable);
    assertEq(r.reason, "missing");
  }
});
test("string numbers compare numerically", () => {
  assert(resolveUpdateStatus("10", "11").updateAvailable);
});

// ============ SOURCE DETECTION ============
suite("Traffic source detection (§24–29)");
const HOST = "sayemwebstore.vercel.app";
test("Facebook UTM (example URL from spec)", () => {
  const v = classifyVisit({ search: "?utm_source=facebook&utm_medium=social&utm_campaign=app_launch", host: HOST, landingPage: "/" });
  assertEq(v.source, "Facebook");
  assertEq(v.sourceType, "Social");
  assertEq(v.medium, "social");
  assertEq(v.campaign, "app_launch");
  assertEq(v.content, null);
  assertEq(v.term, null);
});
test("Google / TikTok / YouTube / Telegram / WhatsApp UTMs", () => {
  const cases = [
    ["utm_source=google", "Google", "Search"],
    ["utm_source=tiktok&utm_medium=social", "TikTok", "Social"],
    ["utm_source=youtube", "YouTube", "Social"],
    ["utm_source=telegram", "Telegram", "Messaging"],
    ["utm_source=whatsapp", "WhatsApp", "Messaging"],
  ];
  for (const [q, source, type] of cases) {
    const v = classifyVisit({ search: `?${q}`, host: HOST });
    assertEq(v.source, source, q);
    assertEq(v.sourceType, type, q);
  }
});
test("unknown UTM source → prettified, medium-driven type", () => {
  const v = classifyVisit({ search: "?utm_source=my-newsletter&utm_medium=email", host: HOST });
  assertEq(v.source, "My Newsletter");
  assertEq(v.sourceType, "Other");
});
test("search referrers classified", () => {
  for (const [ref, source] of [
    ["https://www.google.com/search?q=free+apps", "Google"],
    ["https://www.bing.com/search?q=x", "Bing"],
    ["https://duckduckgo.com/?q=x", "DuckDuckGo"],
    ["https://yandex.ru/search/?text=x", "Yandex"],
    ["https://www.baidu.com/s?wd=x", "Baidu"],
  ]) {
    const v = classifyVisit({ referrer: ref, host: HOST });
    assertEq(v.source, source, ref);
    assertEq(v.sourceType, "Search", ref);
  }
});
test("social/messaging referrers incl. subdomain variants", () => {
  for (const [ref, source, type] of [
    ["https://l.facebook.com/l.php?u=https%3A%2F%2Fsayemwebstore.vercel.app", "Facebook", "Social"],
    ["https://lm.facebook.com/l.php?u=x", "Facebook", "Social"],
    ["https://m.facebook.com/", "Facebook", "Social"],
    ["https://www.instagram.com/", "Instagram", "Social"],
    ["https://www.tiktok.com/@user/video/1", "TikTok", "Social"],
    ["https://t.me/somechannel", "Telegram", "Messaging"],
    ["https://wa.me/8801700000000", "WhatsApp", "Messaging"],
    ["https://x.com/user/status/1", "X (Twitter)", "Social"],
  ]) {
    const v = classifyVisit({ referrer: ref, host: HOST });
    assertEq(v.source, source, ref);
    assertEq(v.sourceType, type, ref);
  }
});
test("unknown external site → host-level Referral, no query strings saved", () => {
  const v = classifyVisit({ referrer: "https://www.example-blog.com/post/7?token=SECRET&x=1", host: HOST });
  assertEq(v.source, "example-blog.com");
  assertEq(v.sourceType, "Referral");
  assertNotIncludes(JSON.stringify(v), "SECRET");
  assertNotIncludes(JSON.stringify(v), "/post/7");
});
test("internal referrer → no attribution (never overwrite with own site)", () => {
  assertEq(classifyVisit({ referrer: `https://${HOST}/apps`, host: HOST }), null);
});
test("no signals → null (direct handled by state machine)", () => {
  assertEq(classifyVisit({ search: "", referrer: "", host: HOST }), null);
});
test("UTM beats referrer", () => {
  const v = classifyVisit({ search: "?utm_source=facebook&utm_campaign=x", referrer: "https://www.google.com/", host: HOST });
  assertEq(v.source, "Facebook");
  assertEq(v.campaign, "x");
});
test("utm without utm_source is not a campaign visit", () => {
  assertEq(classifyVisit({ search: "?utm_campaign=orphan", referrer: "", host: HOST }), null);
});
test("malformed search string → no crash", () => {
  assertEq(classifyVisit({ search: "??&&", host: HOST }), null);
});

// ============ FIRST/LATEST TOUCH + SIGNUP ATTRIBUTION (§30–38) ============
suite("First-touch / latest-touch / signup attribution");
const fbVisit = () => classifyVisit({ search: "?utm_source=facebook&utm_medium=social&utm_campaign=app_launch", host: HOST, landingPage: "/" });
const gVisit = () => classifyVisit({ referrer: "https://www.google.com/search?q=apps", host: HOST, landingPage: "/app/sam-calculator" });

test("Test A — Facebook → homepage → signup", () => {
  let s = applyVisit(defaultState(), fbVisit(), NOW);
  const acq = buildSignupAttribution(s, { userSelectedSource: "", landingPage: "/", now: NOW });
  assertEq(acq.firstTouch.source, "Facebook");
  assertEq(acq.signup.source, "Facebook");
  assertEq(acq.signup.sourceType, "Social");
});
test("Test B — Google → app page → signup keeps first touch Google", () => {
  let s = applyVisit(defaultState(), gVisit(), NOW);
  s = applyVisit(s, null, NOW + 1000, "/apps"); // internal navigation
  const acq = buildSignupAttribution(s, { now: NOW + 2000 });
  assertEq(acq.firstTouch.source, "Google");
  assertEq(acq.firstTouch.landingPage, "/app/sam-calculator");
  assertEq(acq.signup.source, "Google");
});
test("Test C — Google first, Facebook later → signup = Facebook", () => {
  let s = applyVisit(defaultState(), gVisit(), NOW);
  s = applyVisit(s, fbVisit(), NOW + DAY);
  const acq = buildSignupAttribution(s, { now: NOW + DAY });
  assertEq(acq.firstTouch.source, "Google");
  assertEq(acq.latestTouch.source, "Facebook");
  assertEq(acq.signup.source, "Facebook");
  assertEq(acq.signup.campaign, "app_launch");
});
test("Test D — internal navigation never overwrites source", () => {
  let s = applyVisit(defaultState(), fbVisit(), NOW);
  for (const path of ["/apps", "/game/samva-online-tic-tac-toe", "/faq"]) {
    s = applyVisit(s, classifyVisit({ referrer: `https://${HOST}${path}`, host: HOST, landingPage: path }), NOW, path);
  }
  assertEq(s.latestTouch.source, "Facebook");
  assertEq(buildSignupAttribution(s, { now: NOW }).signup.source, "Facebook");
});
test("Test E — no source → Direct", () => {
  let s = applyVisit(defaultState(), null, NOW, "/");
  const acq = buildSignupAttribution(s, { now: NOW });
  assertEq(acq.firstTouch.source, "Direct");
  assertEq(acq.signup.source, "Direct");
  assertEq(acq.signup.sourceType, "Direct");
});
test("Test F — detected Facebook, user answers Friend → both retained", () => {
  let s = applyVisit(defaultState(), fbVisit(), NOW);
  const acq = buildSignupAttribution(s, { userSelectedSource: "Friend / Someone shared it", now: NOW });
  assertEq(acq.signup.source, "Facebook");
  assertEq(acq.userSelectedSource, "Friend / Someone shared it");
  assertEq(acq.firstTouch.source, "Facebook");
});
test("firstTouch never overwritten by later external visit", () => {
  let s = applyVisit(defaultState(), fbVisit(), NOW);
  s = applyVisit(s, gVisit(), NOW + DAY);
  assertEq(s.firstTouch.source, "Facebook");
  assertEq(s.latestTouch.source, "Google");
});
test("direct visit after external does not overwrite latest touch", () => {
  let s = applyVisit(defaultState(), fbVisit(), NOW);
  s = applyVisit(s, null, NOW + DAY);
  assertEq(s.latestTouch.source, "Facebook");
});
test("90-day expiry resets stale touches", () => {
  const old = NOW - (ATTRIBUTION_TTL_DAYS + 1) * DAY;
  let s = applyVisit(defaultState(), fbVisit(), old);
  const sanitized = sanitizeState(s, NOW);
  assertEq(sanitized.firstTouch, null);
  assertEq(sanitized.latestTouch, null);
  s = applyVisit(sanitized, gVisit(), NOW);
  assertEq(s.firstTouch.source, "Google");
});
test("corrupted state object handled safely", () => {
  for (const bad of [null, undefined, 42, "junk", { firstTouch: "nope" }, { firstTouch: { source: 123 } }]) {
    const s = sanitizeState(bad, NOW);
    assert(s && typeof s === "object");
  }
});
test("buildSignupAttribution never throws on garbage", () => {
  const acq = buildSignupAttribution({ firstTouch: { source: {} }, latestTouch: [] }, { now: NOW });
  assert(acq.signup && typeof acq.signup.source === "string" && acq.signup.source.length > 0);
  assertEq(acq.attributionVersion, 1);
});
test("landing page tracking records first public page", () => {
  const v = classifyVisit({ search: "?utm_source=tiktok", host: HOST, landingPage: "/game/samva-online-tic-tac-toe" });
  const s = applyVisit(defaultState(), v, NOW);
  assertEq(s.firstTouch.landingPage, "/game/samva-online-tic-tac-toe");
});
test("signup option preselect mapping", () => {
  assertEq(mapDetectedToSignupOption("Facebook", "Social"), "Facebook");
  assertEq(mapDetectedToSignupOption("Messenger", "Messaging"), "Friend / Someone shared it");
  assertEq(mapDetectedToSignupOption("example-blog.com", "Referral"), "Another website");
  assertEq(mapDetectedToSignupOption("Bing", "Search"), "Another website");
  assertEq(mapDetectedToSignupOption("Direct", "Direct"), "");
  assertEq(mapDetectedToSignupOption("Unknown", "Unknown"), "");
});
test("prettifyUtmSource", () => {
  assertEq(prettifyUtmSource("my-blog_2"), "My Blog 2");
});
test("stripUtmFromSearch keeps non-UTM params", () => {
  assertEq(stripUtmFromSearch("?utm_source=fb&q=x"), "?q=x");
  assertEq(stripUtmFromSearch("?utm_source=fb"), "");
  assertEq(stripUtmFromSearch("?q=x"), null);
});

// ============ SITEMAP (§12) ============
suite("Sitemap builder");
test("contains real app/game URLs and no utm/admin URLs", () => {
  const xml = buildSitemapXml(apps);
  assertIncludes(xml, "https://sayemwebstore.vercel.app/");
  assertIncludes(xml, "/game/samva-online-tic-tac-toe");
  assertIncludes(xml, "/apps");
  assertIncludes(xml, "/faq");
  assertNotIncludes(xml, "utm_");
  assertNotIncludes(xml, "/admin");
  assertNotIncludes(xml, "samva-app-store.firebaseapp.com");
});
test("lastmod only from real timestamps — never invented", () => {
  const xml = buildSitemapXml(apps);
  const legacySlug = getAppPath(apps.find((a) => a.key === "-Test0003keyCCC"), index);
  const legacyBlock = xml.split("<url>").find((b) => b.includes(legacySlug));
  assertNotIncludes(legacyBlock, "<lastmod>");
  const updatedPath = getAppPath(apps.find((a) => a.key === "-Test0001keyAAA"), index);
  const updatedBlock = xml.split("<url>").find((b) => b.includes(updatedPath));
  assertIncludes(updatedBlock, "<lastmod>");
});
test("every catalog app appears exactly once", () => {
  const xml = buildSitemapXml(apps);
  for (const app of apps) {
    const path = getAppPath(app, index);
    const occurrences = xml.split(`<loc>https://sayemwebstore.vercel.app${path}</loc>`).length - 1;
    assertEq(occurrences, 1, path);
  }
});
test("xml is well-formed enough (balanced url tags)", () => {
  const xml = buildSitemapXml(apps);
  assertEq(xml.split("<url>").length, xml.split("</url>").length);
});

// ============ JSON-LD (§9) ============
suite("Structured data");
test("homepage graph has WebSite + Organization + SearchAction", () => {
  const g = homeJsonLd();
  const types = g["@graph"].map((n) => n["@type"]);
  assertIncludes(types.join(","), "WebSite");
  assertIncludes(types.join(","), "Organization");
  assert(g["@graph"][0].potentialAction.target.urlTemplate.includes("/search?q="));
  assertIncludes(JSON.stringify(g), "sayemwebstore.vercel.app");
});
test("app graph: aggregateRating ONLY with real reviews", () => {
  const game = apps.find((a) => a.key === "-Test0002keyBBB");
  const vm = buildAppViewModel(game, { allApps: apps, slugIndex: index });
  const g = JSON.parse(JSON.stringify(appJsonLd(vm)));
  const software = g["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assertEq(software.aggregateRating.ratingValue, 4.5);
  assertEq(software.aggregateRating.reviewCount, 2);
  assertEq(software.review.length, 2);
  assertEq(software.review[0].author.name, "Sadia"); // newest first
  assert(software.review.some((r) => r.author.name === "Rahim"));

  const noReviews = apps.find((a) => a.key === "-Test0003keyCCC");
  const vm2 = buildAppViewModel(noReviews, { allApps: apps, slugIndex: index });
  const g2 = JSON.parse(JSON.stringify(appJsonLd(vm2)));
  const software2 = g2["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assertEq(software2.aggregateRating, undefined);
  assertEq(software2.review, undefined);
});
test("app graph carries real version/package/download data", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index });
  const software = JSON.parse(JSON.stringify(appJsonLd(vm)))["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assertEq(software.softwareVersion, "2.5.1");
  assertEq(software.identifier.value, "com.samva.calculator");
  assertEq(software.downloadUrl, calc.link);
  assertEq(software.operatingSystem, "Android");
  assertEq(software.isAccessibleForFree, true);
});
test("breadcrumb graph matches visible crumbs", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index });
  const page = JSON.parse(JSON.stringify(appJsonLd(vm)))["@graph"].find((n) => n["@type"] === "WebPage");
  const items = page.breadcrumb.itemListElement;
  assertEq(items.length, 4);
  assertEq(items[0].name, "Home");
  assertEq(items[1].name, "Apps");
  assertEq(items[2].name, "Social");
  assertEq(items[3].name, "Sam Calculator");

  // category equal to list level collapses (Games > Games → Games)
  const gameVm = buildAppViewModel(apps.find((a) => a.key === "-Test0002keyBBB"), { allApps: apps, slugIndex: index });
  const gamePage = JSON.parse(JSON.stringify(appJsonLd(gameVm)))["@graph"].find((n) => n["@type"] === "WebPage");
  assertEq(gamePage.breadcrumb.itemListElement.map((i) => i.name).join(">"), "Home>Games>Samva Online Tic Tac Toe");
});

// ============ SHARED RENDERER (client/SSR equivalence) ============
suite("Detail renderer");
test("guest view: login gate, no review form, download anchor open to all", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index, isLoggedIn: false });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, "login-gate-card");
  assertNotIncludes(html, 'id="reviewText"');
  assertIncludes(html, `href="${calc.link}"`);
  assertIncludes(html, "data-download-key"); // delegated handler, no inline JS
  assertIncludes(html, "No login needed");
});
test("logged-in view shows stars + review textarea", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index, isLoggedIn: true, userReview: null });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, 'id="reviewText"');
  assertIncludes(html, "submitReview");
  assertNotIncludes(html, "login-gate-card");
});
test("breadcrumbs + info table + descriptive alts", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, '<nav class="breadcrumbs"');
  assertIncludes(html, "aria-current=\"page\"");
  assertIncludes(html, "<dt>Version</dt><dd>2.5.1</dd>");
  assertIncludes(html, "com.samva.calculator");
  const game = apps.find((a) => a.key === "-Test0002keyBBB");
  const gameHtml = renderAppDetailInner(buildAppViewModel(game, { allApps: apps, slugIndex: index }));
  assertIncludes(gameHtml, "Samva Online Tic Tac Toe — screenshot 1");
  assertNotIncludes(gameHtml, 'alt="Screenshot 1"');
});
test("legacy app without version fields renders without them (no crash)", () => {
  const legacy = apps.find((a) => a.key === "-Test0003keyCCC");
  const vm = buildAppViewModel(legacy, { allApps: apps, slugIndex: index });
  const html = renderAppDetailInner(vm);
  assertNotIncludes(html, "Package Name");
  assertNotIncludes(html, "undefined");
  assertIncludes(html, "CloudKeep Notebook");
});
test("app without link → disabled download, no broken href", () => {
  const noLink = apps.find((a) => a.key === "-Test0005keyEEE");
  const vm = buildAppViewModel(noLink, { allApps: apps, slugIndex: index });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, "disabled");
  assertNotIncludes(html, 'href=""');
});
test("real reviews render with authors; empty state when none", () => {
  const game = apps.find((a) => a.key === "-Test0002keyBBB");
  const vm = buildAppViewModel(game, { allApps: apps, slugIndex: index });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, "Rahim");
  assertIncludes(html, "Great game, no lag!");
  assertIncludes(html, "User Reviews (2)");
  const legacy = apps.find((a) => a.key === "-Test0003keyCCC");
  const html2 = renderAppDetailInner(buildAppViewModel(legacy, { allApps: apps, slugIndex: index }));
  assertIncludes(html2, "No reviews yet");
});
test("related rail links to real paths, excludes self", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index });
  const html = renderAppDetailInner(vm);
  assertIncludes(html, "Related");
  assert(vm.related.every((r) => r.app.key !== calc.key));
  assert(vm.related.every((r) => r.path.startsWith("/app/") || r.path.startsWith("/game/")));
});
test("website detail page NEVER renders update UI (update UI belongs to the Android app/API)", () => {
  const calc = apps.find((a) => a.key === "-Test0001keyAAA");
  for (const installedVersionCode of [10, 25, 30, undefined]) {
    const vm = buildAppViewModel(calc, { allApps: apps, slugIndex: index, installedVersionCode });
    const html = renderAppDetailInner(vm);
    assertNotIncludes(html, "update-banner");
    assertNotIncludes(html, "Update Now");
    assertIncludes(html, "Download Now");
    assertIncludes(html, "data-download-key");
    assertNotIncludes(html, 'target="_blank"');
  }
});
test("isSafeDownloadUrl: http(s) only, no script/data URLs", () => {
  assert(isSafeDownloadUrl("https://raw.githubusercontent.com/md0331400/Sayem-WebStore/main/apps/a.apk"));
  assert(isSafeDownloadUrl(" http://example.org/a.apk "));
  assert(!isSafeDownloadUrl("javascript:alert(1)"));
  assert(!isSafeDownloadUrl("data:text/html,<b>x</b>"));
  assert(!isSafeDownloadUrl(""));
  assert(!isSafeDownloadUrl(null));
  assert(!isSafeDownloadUrl("https://x.y/" + "a".repeat(3000)));
});
test("not-found view links Home / Apps / Games", () => {
  const html = renderNotFoundInner("App");
  assertIncludes(html, 'href="/apps"');
  assertIncludes(html, 'href="/games"');
  assertIncludes(html, 'href="/"');
});
test("card html: crawlable anchor + lazy icon + honest rating label", () => {
  const legacy = apps.find((a) => a.key === "-Test0003keyCCC");
  const html = appCardHtml(legacy, "/app/cloudkeep-notebook");
  assertIncludes(html, '<a class="app-card" href="/app/cloudkeep-notebook"');
  assertIncludes(html, 'loading="lazy"');
  assertIncludes(html, ">New<");
});
test("escapeHtml/truncateText", () => {
  assertEq(escapeHtml(`<b>"x"</b>`), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  assert(truncateText("a".repeat(200), 155).length <= 156);
});

await summarize("Unit tests");
