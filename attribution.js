// ============================================================
// attribution.js — visitor acquisition tracking (Sayem WebStore)
//
// Detects how a visitor arrived (UTM params → external referrer → direct),
// persists first-touch and latest-touch attribution in localStorage, and
// supplies the acquisition object attached to a user record at signup.
//
// Design rules (see production spec):
//   • UTM beats referrer; referrer beats direct.
//   • Internal navigation NEVER overwrites attribution.
//   • firstTouch is written once and never overwritten.
//   • Attribution is non-critical analytics: every entry point is
//     try/catch-guarded so it can never break signup or page load.
//   • No fingerprinting, no raw referrer URLs stored (host-level only),
//     no IP collection, no keystroke tracking.
// ============================================================

export const ATTRIBUTION_STORAGE_KEY = "sayemweb_attribution_v1";
export const ATTRIBUTION_TTL_DAYS = 90;
export const ATTRIBUTION_VERSION = 1;

export const SIGNUP_SOURCE_OPTIONS = [
  "Google",
  "Facebook",
  "Instagram",
  "TikTok",
  "YouTube",
  "Telegram",
  "WhatsApp",
  "Friend / Someone shared it",
  "Another website",
  "Other",
];

// hostname (lowercase, exact or suffix match) → [canonical source, source type]
const KNOWN_SOURCES = [
  // Social
  ["facebook.com", "Facebook", "Social"],
  ["fb.com", "Facebook", "Social"],
  ["fb.me", "Facebook", "Social"],
  ["instagram.com", "Instagram", "Social"],
  ["tiktok.com", "TikTok", "Social"],
  ["youtube.com", "YouTube", "Social"],
  ["youtu.be", "YouTube", "Social"],
  ["twitter.com", "X (Twitter)", "Social"],
  ["x.com", "X (Twitter)", "Social"],
  ["t.co", "X (Twitter)", "Social"],
  ["reddit.com", "Reddit", "Social"],
  ["pinterest.com", "Pinterest", "Social"],
  ["linkedin.com", "LinkedIn", "Social"],
  ["lnkd.in", "LinkedIn", "Social"],
  // Messaging
  ["telegram.org", "Telegram", "Messaging"],
  ["telegram.me", "Telegram", "Messaging"],
  ["t.me", "Telegram", "Messaging"],
  ["whatsapp.com", "WhatsApp", "Messaging"],
  ["wa.me", "WhatsApp", "Messaging"],
  ["messenger.com", "Messenger", "Messaging"],
  ["m.me", "Messenger", "Messaging"],
  // Search
  ["google.com", "Google", "Search"],
  ["bing.com", "Bing", "Search"],
  ["yahoo.com", "Yahoo", "Search"],
  ["duckduckgo.com", "DuckDuckGo", "Search"],
  ["baidu.com", "Baidu", "Search"],
  ["yandex.com", "Yandex", "Search"],
  ["yandex.ru", "Yandex", "Search"],
];

/** Matches hostname exactly or as a subdomain / country TLD variant (google.co.uk, m.facebook.com…). */
function matchKnownSource(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  for (const [domain, source, type] of KNOWN_SOURCES) {
    if (host === domain || host.endsWith(`.${domain}`)) return { source, sourceType: type };
    // country variants: google.co.uk, google.com.bd, yandex.by …
    const bare = domain.replace(/\.(com|org|me|ru)$/, "");
    if (bare.length > 3 && host.startsWith(`${bare}.`) && !host.includes("googleapis")) {
      return { source, sourceType: type };
    }
  }
  return null;
}

/** "facebook" → "Facebook", "my-blog" → "My Blog" — for utm_source values without a brand match. */
export function prettifyUtmSource(raw) {
  return String(raw || "")
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// utm_source values (lowercase) → canonical brand even when written without a domain
const KNOWN_UTM_ALIASES = {
  facebook: ["Facebook", "Social"],
  fb: ["Facebook", "Social"],
  meta: ["Facebook", "Social"],
  instagram: ["Instagram", "Social"],
  insta: ["Instagram", "Social"],
  ig: ["Instagram", "Social"],
  tiktok: ["TikTok", "Social"],
  youtube: ["YouTube", "Social"],
  yt: ["YouTube", "Social"],
  google: ["Google", "Search"],
  twitter: ["X (Twitter)", "Social"],
  x: ["X (Twitter)", "Social"],
  reddit: ["Reddit", "Social"],
  pinterest: ["Pinterest", "Social"],
  linkedin: ["LinkedIn", "Social"],
  telegram: ["Telegram", "Messaging"],
  whatsapp: ["WhatsApp", "Messaging"],
  messenger: ["Messenger", "Messaging"],
  bing: ["Bing", "Search"],
  yahoo: ["Yahoo", "Search"],
  duckduckgo: ["DuckDuckGo", "Search"],
  baidu: ["Baidu", "Search"],
  yandex: ["Yandex", "Search"],
};

function classifyUtm(params) {
  const source = (params.get("utm_source") || "").trim();
  if (!source) return null; // UTM attribution requires utm_source
  const medium = (params.get("utm_medium") || "").trim().toLowerCase();

  let canonical = null;
  let sourceType = null;

  const aliasKey = source.toLowerCase().replace(/^www\./, "");
  if (KNOWN_UTM_ALIASES[aliasKey]) {
    [canonical, sourceType] = KNOWN_UTM_ALIASES[aliasKey];
  } else {
    const known = matchKnownSource(aliasKey);
    if (known) {
      canonical = known.source;
      sourceType = known.sourceType;
    } else {
      canonical = prettifyUtmSource(source);
      if (medium.includes("social")) sourceType = "Social";
      else if (medium.includes("search") || medium.includes("organic")) sourceType = "Search";
      else if (medium.includes("messaging") || medium.includes("chat")) sourceType = "Messaging";
      else if (medium.includes("referral")) sourceType = "Referral";
      else sourceType = "Other";
    }
  }

  return {
    source: canonical,
    sourceType,
    medium: medium || null,
    campaign: (params.get("utm_campaign") || "").trim().toLowerCase() || null,
    content: (params.get("utm_content") || "").trim() || null,
    term: (params.get("utm_term") || "").trim() || null,
    via: "utm",
  };
}

function classifyReferrer(referrer, currentHost) {
  if (!referrer) return null;
  let url;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  if (host === String(currentHost || "").toLowerCase()) return null; // internal navigation — never attribute

  const known = matchKnownSource(host);
  if (known) {
    return { source: known.source, sourceType: known.sourceType, medium: "referral", campaign: null, content: null, term: null, via: "referrer" };
  }
  // Unknown external site → store host-level only (no query strings, no paths — privacy).
  return { source: host.replace(/^www\./, ""), sourceType: "Referral", medium: "referral", campaign: null, content: null, term: null, via: "referrer" };
}

/**
 * Pure classification of one page load. Returns a visit descriptor or null
 * when there is no external acquisition signal (internal nav / plain load).
 */
export function classifyVisit({ search = "", referrer = "", host = "", landingPage = "/" } = {}) {
  let params;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    return null;
  }
  const utm = classifyUtm(params);
  if (utm) return { ...utm, landingPage };
  const ref = classifyReferrer(referrer, host);
  if (ref) return { ...ref, landingPage };
  return null;
}

function emptyTouch() {
  return { source: "", sourceType: "", medium: "", campaign: "", content: "", term: "", landingPage: "", firstSeenAt: "", lastSeenAt: "" };
}

function touchFromVisit(visit, tsField, now, landingPage) {
  return {
    source: visit ? visit.source : "Direct",
    sourceType: visit ? visit.sourceType : "Direct",
    medium: visit ? visit.medium || "" : "",
    campaign: visit ? visit.campaign || "" : "",
    content: visit ? visit.content || "" : "",
    term: visit ? visit.term || "" : "",
    landingPage: (visit && visit.landingPage) || landingPage || "/",
    [tsField]: now,
  };
}

function isValidTouch(t) {
  return !!t && typeof t === "object" && typeof t.source === "string" && t.source !== "";
}

function isExpiredTouch(t, tsField, now) {
  const ts = Number(t && t[tsField]);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return now - ts > ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function defaultState() {
  return { version: ATTRIBUTION_VERSION, firstTouch: null, latestTouch: null };
}

/** Validates persisted state; corrupted/expired pieces are dropped safely. */
export function sanitizeState(raw, now = Date.now()) {
  const state = defaultState();
  if (!raw || typeof raw !== "object") return state;
  if (isValidTouch(raw.firstTouch) && !isExpiredTouch(raw.firstTouch, "firstSeenAt", now)) {
    state.firstTouch = { ...emptyTouch(), ...raw.firstTouch };
  }
  if (isValidTouch(raw.latestTouch) && !isExpiredTouch(raw.latestTouch, "lastSeenAt", now)) {
    state.latestTouch = { ...emptyTouch(), ...raw.latestTouch };
  }
  return state;
}

/**
 * Applies one classified visit (or null) to the attribution state.
 * Pure — returns a new state object; persistence is handled by the caller.
 */
export function applyVisit(state, visit, now = Date.now(), landingPage = "/") {
  const next = { version: ATTRIBUTION_VERSION, firstTouch: state && state.firstTouch ? state.firstTouch : null, latestTouch: state && state.latestTouch ? state.latestTouch : null };

  if (visit) {
    if (!next.firstTouch) next.firstTouch = touchFromVisit(visit, "firstSeenAt", now, landingPage);
    next.latestTouch = touchFromVisit(visit, "lastSeenAt", now, landingPage);
  } else if (!next.firstTouch) {
    // First ever visit with no external signal → Direct (honest, not guessed).
    next.firstTouch = touchFromVisit(null, "firstSeenAt", now, landingPage);
    next.latestTouch = touchFromVisit(null, "lastSeenAt", now, landingPage);
  }
  return next;
}

/**
 * Builds the `acquisition` object saved on the user record at signup.
 * Signup attribution uses the latest relevant external touch; when none
 * exists it falls back to first touch, then Direct.
 */
export function buildSignupAttribution(state, { userSelectedSource = "", landingPage = "/", now = Date.now() } = {}) {
  const safeState = sanitizeState(state, now);
  const firstTouch = safeState.firstTouch || touchFromVisit(null, "firstSeenAt", now, landingPage);
  const latestTouch = safeState.latestTouch || firstTouch;

  const base = latestTouch && latestTouch.source && latestTouch.source !== "Direct" ? latestTouch
    : firstTouch && firstTouch.source ? firstTouch
    : latestTouch;

  const signup = {
    source: (base && base.source) || "Unknown",
    sourceType: (base && base.sourceType) || "Unknown",
    medium: (base && base.medium) || "",
    campaign: (base && base.campaign) || "",
    content: (base && base.content) || "",
    term: (base && base.term) || "",
    landingPage: (base && base.landingPage) || landingPage || "/",
    signupAt: now,
  };

  return {
    firstTouch: { ...firstTouch, lastSeenAt: firstTouch.lastSeenAt || "" },
    latestTouch: { ...latestTouch, firstSeenAt: latestTouch.firstSeenAt || "" },
    signup,
    userSelectedSource: String(userSelectedSource || ""),
    attributionVersion: ATTRIBUTION_VERSION,
  };
}

/** Maps a detected source onto the "How did you hear about us?" options. */
export function mapDetectedToSignupOption(source, sourceType) {
  const s = String(source || "").toLowerCase();
  if (s.includes("google")) return "Google";
  if (s.includes("facebook")) return "Facebook";
  if (s.includes("instagram")) return "Instagram";
  if (s.includes("tiktok")) return "TikTok";
  if (s.includes("youtube")) return "YouTube";
  if (s.includes("telegram")) return "Telegram";
  if (s.includes("whatsapp")) return "WhatsApp";
  if (s.includes("messenger")) return "Friend / Someone shared it";
  if (sourceType === "Referral" || sourceType === "Search") return "Another website";
  if (source && source !== "Direct" && source !== "Unknown") return "Another website";
  return ""; // Direct / Unknown → no honest preselect; user chooses (optional)
}

/** Removes utm_* params from a search string (canonical hygiene). */
export function stripUtmFromSearch(search) {
  try {
    const params = new URLSearchParams(search || "");
    let changed = false;
    for (const key of Array.from(params.keys())) {
      if (/^utm_/i.test(key)) {
        params.delete(key);
        changed = true;
      }
    }
    return changed ? `?${params.toString()}`.replace(/\?$/, "") : null;
  } catch {
    return null;
  }
}

// ---------- browser bootstrap (guarded; never throws) ----------

let runtimeState = defaultState();

function safeGetStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode / blocked storage → in-memory only
  }
}

export function loadAttributionState(storage = safeGetStorage()) {
  try {
    const raw = storage && storage.getItem(ATTRIBUTION_STORAGE_KEY);
    return sanitizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultState();
  }
}

export function saveAttributionState(state, storage = safeGetStorage()) {
  try {
    storage && storage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/**
 * Runs once per full page load: classify the visit, persist state, and strip
 * utm_* params from the visible URL so canonicals/shares stay clean.
 * Internal SPA navigation never calls this again → source is never
 * overwritten by internal movement.
 */
const VISIT_BEACON_KEY = "sayem_visit_beacon_v1";

/**
 * Privacy-light aggregate analytics: at most ONE beacon per browser session
 * (sessionStorage-gated), carrying only the normalized source/type/campaign
 * and the landing path. No identity, no IP, no fingerprint, best-effort —
 * failures are swallowed and can never block rendering or signup.
 */
export function sendVisitBeacon(state, landingPage) {
  try {
    if (typeof window === "undefined" || !window.fetch) return;
    if (window.sessionStorage && window.sessionStorage.getItem(VISIT_BEACON_KEY)) return;
    const touch = (state && (state.latestTouch || state.firstTouch)) || null;
    const payload = {
      source: touch && touch.source ? touch.source : "Direct",
      sourceType: touch && touch.sourceType ? touch.sourceType : "Direct",
      campaign: touch && touch.campaign ? touch.campaign : "",
      landing: landingPage || (window.location && window.location.pathname) || "/",
    };
    if (window.sessionStorage) window.sessionStorage.setItem(VISIT_BEACON_KEY, "1");
    window
      .fetch("/api/visit", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      .catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
}

export function initAttribution({ landingPage } = {}) {
  try {
    const path = landingPage || window.location.pathname || "/";
    const visit = classifyVisit({
      search: window.location.search || "",
      referrer: document.referrer || "",
      host: window.location.hostname,
      landingPage: path,
    });

    const stored = loadAttributionState();
    runtimeState = applyVisit(stored, visit, Date.now(), path);
    saveAttributionState(runtimeState);

    // Clean UTM params from the address bar (page keeps working; canonical stays clean)
    const cleaned = stripUtmFromSearch(window.location.search);
    if (cleaned !== null && window.history && window.history.replaceState) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${cleaned || ""}${window.location.hash || ""}`);
    }

    sendVisitBeacon(runtimeState, path);
    return runtimeState;
  } catch {
    return defaultState();
  }
}

/** Current attribution state (never throws). */
export function getAttributionState() {
  try {
    if (!runtimeState || (!runtimeState.firstTouch && !runtimeState.latestTouch)) {
      runtimeState = loadAttributionState();
    }
    return runtimeState;
  } catch {
    return defaultState();
  }
}

/**
 * Acquisition object for signup. Guaranteed to return a well-formed object —
 * attribution failure must never block account creation.
 */
export function getSignupAcquisition(userSelectedSource) {
  try {
    return buildSignupAttribution(getAttributionState(), {
      userSelectedSource: userSelectedSource || "",
      landingPage: (typeof window !== "undefined" && window.location && window.location.pathname) || "/",
    });
  } catch {
    const now = Date.now();
    const fallback = { source: "Unknown", sourceType: "Unknown", medium: "", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: now, lastSeenAt: now };
    return {
      firstTouch: fallback,
      latestTouch: fallback,
      signup: { ...fallback, signupAt: now },
      userSelectedSource: String(userSelectedSource || ""),
      attributionVersion: ATTRIBUTION_VERSION,
    };
  }
}

/** Best preselect for the signup question (empty string = no honest guess). */
export function getSuggestedSignupOption() {
  try {
    const state = getAttributionState();
    const touch = state.latestTouch || state.firstTouch;
    if (!touch) return "";
    return mapDetectedToSignupOption(touch.source, touch.sourceType);
  } catch {
    return "";
  }
}
