// ============================================================
// api/sitemap.js — dynamic sitemap built from REAL Firebase app records.
// Served at /sitemap.xml via vercel.json rewrite.
//
// • Only genuine public URLs (home, list pages, info pages, app/game pages).
// • No admin/login/UTM URLs, ever.
// • lastmod is emitted only when a record carries a real timestamp.
// ============================================================

const FIREBASE_DB_BASE =
  process.env.FIREBASE_DATABASE_URL ||
  "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app";

const FALLBACK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://sayemwebstore.vercel.app/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://sayemwebstore.vercel.app/apps</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>https://sayemwebstore.vercel.app/games</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
</urlset>
`;

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");

  const appsData = await fetchJson(`${FIREBASE_DB_BASE}/apps.json`);
  const apps =
    appsData && typeof appsData === "object"
      ? Object.entries(appsData).map(([key, value]) => ({ key, ...(value && typeof value === "object" ? value : {}) }))
      : [];

  let xml;
  let usedFallback = true;
  try {
    const { buildSitemapXml } = await import("../seo-utils.js");
    xml = buildSitemapXml(apps);
    usedFallback = false;
  } catch {
    xml = FALLBACK_XML;
  }

  // Edge-cache the generated sitemap; serve stale while revalidating.
  if (!usedFallback && apps.length) {
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
  } else {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
  }
  res.status(200).send(xml);
};
