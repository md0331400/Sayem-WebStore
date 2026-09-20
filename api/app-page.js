// ============================================================
// api/app-page.js — pre-rendered app/game pages for crawlers & social bots.
//
// vercel.json rewrites /app/{slug} and /game/{slug} here ONLY when the
// user-agent is a known crawler/preview bot. Real visitors keep getting the
// fast static shell + client router (identical content after JS runs).
//
// The function fetches the deployed index.html and the real Firebase app
// record, then injects:
//   • unique title / description / canonical / OG / Twitter tags
//   • SoftwareApplication + WebPage + BreadcrumbList JSON-LD (real data only)
//   • the same visible detail markup the client renders (shared renderer)
// Unknown slugs return a real 404; wrong type prefix returns a 301 to the
// canonical path.
// ============================================================

const PROD_ORIGIN = "https://sayemwebstore.vercel.app";
const FIREBASE_DB_BASE =
  process.env.FIREBASE_DATABASE_URL ||
  "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app";

// Deployment-scoped URLs (VERCEL_URL) can sit behind Vercel Deployment
// Protection (SSO), which would return a login page instead of the shell.
// The public production URL is the reliable source; SHELL_BASE_URL overrides
// everything for local testing.
const SHELL_MARKER = 'id="appDetailPageContent"';
const NOTFOUND_MARKER = "<title>404";

function shellBase() {
  if (process.env.SHELL_BASE_URL) return process.env.SHELL_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return PROD_ORIGIN;
}

/** Minimal self-contained SSR document — used if the deployed shell cannot be
 *  fetched/validated, so crawlers always receive full SEO signals + content. */
function standaloneSsrPage({ vm, siteName, ogImage, ogTitle, jsonLd, inner }) {
  const e = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(vm.title)}</title>
<meta name="description" content="${e(vm.metaDescription)}">
<link rel="canonical" href="${e(vm.url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${e(siteName)}">
<meta property="og:title" content="${e(ogTitle)}">
<meta property="og:description" content="${e(vm.metaDescription)}">
<meta property="og:url" content="${e(vm.url)}">
<meta property="og:image" content="${e(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(ogTitle)}">
<meta name="twitter:description" content="${e(vm.metaDescription)}">
<meta name="twitter:image" content="${e(ogImage)}">
<script type="application/ld+json" id="pageJsonLd">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main id="appDetailPage" class="page active">
  <div id="appDetailPageContent">${inner}</div>
</main>
</body>
</html>`;
}

async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 8000) {
  const text = await fetchText(url, timeoutMs);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceOnce(html, pattern, replacement) {
  return html.replace(pattern, () => replacement);
}

function setMetaTagContent(html, tagPattern, attr, value) {
  const match = html.match(tagPattern);
  if (!match) return html;
  const tag = match[0];
  const attrPattern = new RegExp(`${attr}="[^"]*"`);
  const updated = attrPattern.test(tag)
    ? tag.replace(attrPattern, `${attr}="${escAttr(value)}"`)
    : tag.replace(/>$/, ` ${attr}="${escAttr(value)}">`);
  return replaceOnce(html, tagPattern, updated);
}

function injectMeta(html, { title, description, canonical, ogImage, ogTitle, ogDescription, jsonLdJson }) {
  let out = html;
  out = replaceOnce(out, /<title>[\s\S]*?<\/title>/, `<title>${escAttr(title)}</title>`);
  out = setMetaTagContent(out, /<meta\s+name="description"[^>]*>/i, "content", description);
  out = setMetaTagContent(out, /<link\s+rel="canonical"[^>]*>/i, "href", canonical);
  out = setMetaTagContent(out, /<meta\s+property="og:title"[^>]*>/i, "content", ogTitle || title);
  out = setMetaTagContent(out, /<meta\s+property="og:description"[^>]*>/i, "content", ogDescription || description);
  out = setMetaTagContent(out, /<meta\s+property="og:url"[^>]*>/i, "content", canonical);
  out = setMetaTagContent(out, /<meta\s+property="og:image"[^>]*>/i, "content", ogImage);
  out = setMetaTagContent(out, /<meta\s+name="twitter:title"[^>]*>/i, "content", ogTitle || title);
  out = setMetaTagContent(out, /<meta\s+name="twitter:description"[^>]*>/i, "content", ogDescription || description);
  out = setMetaTagContent(out, /<meta\s+name="twitter:image"[^>]*>/i, "content", ogImage);
  if (jsonLdJson) {
    out = replaceOnce(
      out,
      /<script type="application\/ld\+json" id="pageJsonLd">[\s\S]*?<\/script>/,
      `<script type="application/ld+json" id="pageJsonLd">${JSON.stringify(jsonLdJson)}</script>`
    );
  }
  return out;
}

const SIMPLE_404 = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>404 — Not Found | Sayem WebStore</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px;">
<h1>😕 Not found</h1>
<p>That page does not exist on Sayem WebStore.</p>
<p><a href="https://sayemwebstore.vercel.app/apps">Browse Apps</a> · <a href="https://sayemwebstore.vercel.app/games">Browse Games</a> · <a href="https://sayemwebstore.vercel.app/">Home</a></p>
</body></html>`;

module.exports = async function handler(req, res) {
  const query = new URL(req.url, "http://internal.local").searchParams;
  const slug = String(query.get("slug") || "").trim();
  const typeHint = query.get("type") === "game" ? "game" : "app";

  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");

  if (!slug || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(404).send(SIMPLE_404);
    return;
  }

  const base = shellBase();
  const [shellHtmlRaw, appsData, siteNameData] = await Promise.all([
    fetchText(`${base}/index.html`),
    fetchJson(`${FIREBASE_DB_BASE}/apps.json`),
    fetchJson(`${FIREBASE_DB_BASE}/settings/websiteName.json`),
  ]);

  // Validate the shell: an unvalidated document (e.g. a Deployment Protection
  // login page) must never receive injected meta or be served as an app page.
  let shellHtml = shellHtmlRaw && shellHtmlRaw.includes(SHELL_MARKER) ? shellHtmlRaw : null;
  if (!shellHtml && base !== PROD_ORIGIN) {
    const retry = await fetchText(`${PROD_ORIGIN}/index.html`);
    if (retry && retry.includes(SHELL_MARKER)) shellHtml = retry;
  }

  // No usable shell AND no catalog → nothing safe to render.
  if (!shellHtml && !appsData) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(SIMPLE_404.replace("<title>404 — Not Found | Sayem WebStore</title>", "<title>Temporarily unavailable | Sayem WebStore</title>").replace("😕 Not found", "😕 Temporarily unavailable"));
    return;
  }

  let utils;
  try {
    utils = await import("../seo-utils.js");
  } catch {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(shellHtml || SIMPLE_404.replace("<title>404 — Not Found | Sayem WebStore</title>", "<title>Temporarily unavailable | Sayem WebStore</title>"));
    return;
  }

  const apps =
    appsData && typeof appsData === "object"
      ? Object.entries(appsData).map(([key, value]) => ({ key, ...(value && typeof value === "object" ? value : {}) }))
      : [];

  const siteName =
    typeof siteNameData === "string" && siteNameData.trim() ? siteNameData.trim() : utils.SITE_NAME_DEFAULT;

  const index = utils.buildAppSlugIndex(apps);
  const appKey = index.bySlug.get(slug);
  const app = appKey ? apps.find((a) => a.key === appKey) : null;

  // ---- Unknown slug → real 404 (never show an unrelated app) ----
  if (!app) {
    let notFoundHtml = await fetchText(`${base}/404.html`);
    if (!notFoundHtml || !notFoundHtml.includes(NOTFOUND_MARKER)) {
      notFoundHtml = base === PROD_ORIGIN ? null : await fetchText(`${PROD_ORIGIN}/404.html`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(404).send(notFoundHtml && notFoundHtml.includes(NOTFOUND_MARKER) ? notFoundHtml : SIMPLE_404);
    return;
  }

  // ---- Wrong type prefix → 301 to the canonical path ----
  const canonicalPath = utils.getAppPath(app, index);
  if (canonicalPath !== `/${typeHint}/${slug}`) {
    res.setHeader("Location", `${PROD_ORIGIN}${canonicalPath}`);
    res.status(301).send("");
    return;
  }

  // ---- Render the real app page ----
  const vm = utils.buildAppViewModel(app, {
    allApps: apps,
    slugIndex: index,
    siteName,
    origin: PROD_ORIGIN,
    isLoggedIn: false,
    userReview: null,
    installedVersionCode: null,
  });

  const ogImage =
    app.imageUrl && String(app.imageUrl).startsWith("http") ? String(app.imageUrl) : `${PROD_ORIGIN}/icons/icon-512.png`;
  const ogTitle = `${app.name || vm.typeLabel} — ${vm.typeLabel} Download | ${siteName}`;
  const jsonLd = utils.appJsonLd(vm);
  const inner = utils.renderAppDetailInner(vm);

  let html;
  if (shellHtml) {
    html = shellHtml;
    // Activate the detail page, deactivate the home page (visible content for non-JS crawlers)
    html = replaceOnce(html, /<main id="homePage" class="page active">/, '<main id="homePage" class="page">');
    html = replaceOnce(html, /<div id="appDetailPage" class="page">/, '<div id="appDetailPage" class="page active">');
    html = replaceOnce(html, /<div id="appDetailPageContent"><\/div>/, `<div id="appDetailPageContent">${inner}</div>`);
    html = injectMeta(html, {
      title: vm.title,
      description: vm.metaDescription,
      canonical: vm.url,
      ogImage,
      ogTitle,
      ogDescription: vm.metaDescription,
      jsonLdJson: jsonLd,
    });
  } else {
    html = standaloneSsrPage({ vm, siteName, ogImage, ogTitle, jsonLd, inner });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
};
