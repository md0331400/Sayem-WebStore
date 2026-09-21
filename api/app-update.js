// ============================================================
// api/app-update.js — public read-only update-check API for the
// FUTURE NATIVE ANDROID APP.
//
//   GET /api/app-update?packageName=com.example.app&versionCode=20
//
// Architecture (do not blur these lines):
//   • GitHub Raw  = APK file host (downloadUrl returned as-is, never proxied)
//   • Firebase    = app catalog / source of truth (same `apps` path the
//                   website and admin panel use)
//   • Vercel      = website + this JSON API layer
//   • Android app = owns the update dialog; this repo only exposes data
//   • WEBSITE UPDATE UI = NONE (the catalog never shows update banners)
//
// The endpoint requires no login, no cookies and exposes no credentials.
// It only READS the public app catalog. Comparison rule (single source of
// truth, imported from seo-utils.js): latestVersionCode > installedVersionCode.
// ============================================================

const FIREBASE_DB_BASE =
  process.env.FIREBASE_DATABASE_URL ||
  "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app";

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const MAX_PACKAGE_LEN = 100;

function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); // update info must never go stale
  res.setHeader("Access-Control-Allow-Origin", "*"); // public read-only API (Android)
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(status).send(JSON.stringify(body));
}

function toIntegerCode(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  if (req.method !== "GET") {
    json(res, 405, { error: "method-not-allowed", message: "Use GET for update checks." });
    return;
  }

  let params;
  try {
    params = new URL(req.url, "http://internal.local").searchParams;
  } catch {
    json(res, 400, { error: "invalid-request" });
    return;
  }

  const packageName = String(params.get("packageName") || "").trim();
  const versionRaw = String(params.get("versionCode") || "").trim();

  if (!packageName || packageName.length > MAX_PACKAGE_LEN || !PACKAGE_RE.test(packageName)) {
    json(res, 400, { error: "invalid-package", message: "packageName must be an Android package id (e.g. com.example.app)." });
    return;
  }
  const installedVersionCode = toIntegerCode(versionRaw);
  if (installedVersionCode === null) {
    json(res, 400, { error: "invalid-version-code", message: "versionCode must be a non-negative integer." });
    return;
  }

  let apps;
  try {
    const response = await fetch(`${FIREBASE_DB_BASE}/apps.json`);
    if (!response.ok) throw new Error("catalog fetch failed");
    apps = await response.json();
  } catch {
    // Never leak internals, secrets or stack traces.
    json(res, 500, { error: "catalog-unavailable" });
    return;
  }

  const list = apps && typeof apps === "object" ? Object.entries(apps) : [];
  const entry = list.find(([, a]) => a && typeof a === "object" && String(a.packageName || "") === packageName);
  if (!entry) {
    json(res, 200, { found: false, updateAvailable: false, reason: "not-listed", packageName });
    return;
  }

  const [key, app] = entry;
  const { resolveUpdateStatus, buildAppSlugIndex, getAppPath } = await import("../seo-utils.js");

  const latestVersionCode = toIntegerCode(app.versionCode);
  const status =
    latestVersionCode === null
      ? { updateAvailable: false, reason: "version-unavailable" }
      : resolveUpdateStatus(installedVersionCode, latestVersionCode);

  let appUrl = null;
  try {
    const appsArray = list.map(([k, a]) => ({ key: k, ...a }));
    const slugIndex = buildAppSlugIndex(appsArray);
    const found = appsArray.find((a) => a.key === key);
    const origin = process.env.SITE_ORIGIN || "https://sayemwebstore.vercel.app";
    appUrl = `${origin}${getAppPath(found, slugIndex)}`;
  } catch {
    appUrl = null;
  }

  const downloadUrl = typeof app.link === "string" && /^https?:\/\//i.test(app.link.trim()) ? app.link.trim() : null;

  json(res, 200, {
    found: true,
    packageName,
    name: typeof app.name === "string" ? app.name : "",
    latestVersionName: typeof app.versionName === "string" && app.versionName ? app.versionName : null,
    latestVersionCode,
    installedVersionCode,
    updateAvailable: Boolean(status.updateAvailable),
    reason: status.reason,
    downloadType: downloadUrl ? "direct" : null, // GitHub Raw direct file URL; never proxied
    downloadUrl,
    appUrl,
  });
};
