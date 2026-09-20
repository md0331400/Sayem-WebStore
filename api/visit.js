// POST/GET /api/visit — privacy-light anonymous traffic-source aggregation.
//
// Counts ONE visit per browser session (the client gates this with a
// sessionStorage flag). Stores only aggregate daily counters:
//   analytics/daily/{YYYY-MM-DD}/sources/{source}/visits
//   analytics/daily/{YYYY-MM-DD}/sources/{source}/signups   (incremented at signup)
//   analytics/daily/{YYYY-MM-DD}/landing/{path}/visits
//   analytics/daily/{YYYY-MM-DD}/visits
// No IPs, no cookies, no device identifiers, no raw query strings, no identity.
// Values are normalized server-side; unknown/garbage input falls back to "Unknown".

const FIREBASE_DB_BASE =
  process.env.FIREBASE_DATABASE_URL ||
  "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app";

const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'&-]{0,39}$/;
const CAMPAIGN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const TYPES = new Set(["Search", "Social", "Messaging", "Referral", "Direct", "Other", "Unknown"]);

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Keep only safe, public landing-path shapes; drop queries and exotic paths. */
function normalizeLanding(raw) {
  let p = String(raw || "");
  if (!p.startsWith("/")) return "";
  p = p.split("?")[0].split("#")[0];
  if (p.length > 80) return "";
  if (/^\/(app|game)\/[a-z0-9-]{1,80}$/.test(p)) return p;
  const first = p.split("/")[1] || "";
  if (/^[a-z-]{0,20}$/.test(first)) return first ? `/${first}` : "/";
  return "";
}

const CANON = {
  facebook: "Facebook", google: "Google", instagram: "Instagram", tiktok: "TikTok",
  youtube: "YouTube", twitter: "Twitter", x: "X", whatsapp: "WhatsApp",
  messenger: "Messenger", reddit: "Reddit", linkedin: "LinkedIn", pinterest: "Pinterest",
  snapchat: "Snapchat", telegram: "Telegram", direct: "Direct", bing: "Bing", duckduckgo: "DuckDuckGo",
};

/** Canonical display key so aggregate counters join with signup source names. */
function sourceKey(source) {
  const s = String(source || "").trim();
  if (!SOURCE_RE.test(s)) return "Unknown";
  const low = s.toLowerCase();
  if (CANON[low]) return CANON[low];
  return s.replace(/[.'&]/g, "").replace(/\s+/g, "_").slice(0, 40) || "Unknown";
}

async function fbGet(path) {
  try {
    const res = await fetch(`${FIREBASE_DB_BASE}${path}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fbIncrement(path, by = 1) {
  const current = Number(await fbGet(path)) || 0;
  try {
    await fetch(`${FIREBASE_DB_BASE}${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(current + by),
    });
  } catch {
    // aggregation is best-effort; never fail the visitor's request
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).send("");
    return;
  }

  let payload = {};
  try {
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) break;
      }
      payload = JSON.parse(body || "{}");
    } else {
      const q = new URL(req.url, "http://internal.local").searchParams;
      payload = { source: q.get("source"), sourceType: q.get("type"), campaign: q.get("campaign"), landing: q.get("landing") };
    }
  } catch {
    payload = {};
  }

  const source = SOURCE_RE.test(String(payload.source || "").trim()) ? String(payload.source).trim() : "Unknown";
  const sourceType = TYPES.has(payload.sourceType) ? payload.sourceType : "Unknown";
  const campaign = CAMPAIGN_RE.test(String(payload.campaign || "").trim()) ? String(payload.campaign).trim() : "";
  const landing = normalizeLanding(payload.landing);
  const day = dayKey();
  const sKey = sourceKey(source);

  const writes = [
    fbIncrement(`/analytics/daily/${day}/visits`),
    fbIncrement(`/analytics/daily/${day}/sources/${sKey}/visits`),
  ];
  if (landing) writes.push(fbIncrement(`/analytics/daily/${day}/landing/${landing.replace(/\//g, "~")}/visits`));
  if (campaign) writes.push(fbIncrement(`/analytics/daily/${day}/campaigns/${sourceKey(campaign)}/visits`));
  await Promise.all(writes);

  res.status(204).send("");
};
