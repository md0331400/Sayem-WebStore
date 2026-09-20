// ============================================================
// seo-utils.js — shared SEO helpers (browser storefront + Vercel serverless functions)
//
// This module is imported by:
//   • app.js            (client router / metadata / detail rendering)
//   • api/app-page.js   (crawler-facing pre-rendered app pages)
//   • api/sitemap.js    (dynamic sitemap built from real Firebase app records)
//
// It must stay dependency-free and side-effect-free so it can run
// unchanged in the browser (ESM) and in Node (via dynamic import).
// ============================================================

export const SITE_ORIGIN = "https://sayemwebstore.vercel.app";
export const SITE_NAME_DEFAULT = "Sayem WebStore";
export const FIREBASE_DB_BASE = "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app";

export const HOME_META = {
  title: `${SITE_NAME_DEFAULT} — Free Apps & Games Download`,
  description:
    "Sayem WebStore is a free platform to discover, review and download apps and games for Android. Browse the catalog, read real user reviews and download in one tap — no login needed.",
};

// ---------- small helpers ----------

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncateText(text, max = 155) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:!?\-]+$/, "")}…`;
}

export function formatDateLabel(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// ---------- app type / slugs ----------

export function isGameApp(app) {
  return String((app && app.category) || "").toLowerCase().includes("game");
}

/** "/app" for regular apps, "/game" for games — based on the real category. */
export function appTypeSegment(app) {
  return isGameApp(app) ? "game" : "app";
}

/** Stable, URL-safe slug from an app name. Falls back to the record key for non-Latin names. */
export function slugify(name, fallbackKey = "") {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accent marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (base) return base;
  const keyTail = String(fallbackKey || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase();
  return keyTail ? `app-${keyTail}` : "app";
}

/**
 * Builds slug indexes for the whole catalog.
 * Duplicate names are disambiguated deterministically with a key suffix so the
 * same slug is produced on the client and in serverless functions, regardless
 * of record ordering.
 *
 * @param {Array<{key:string, name?:string}>} apps
 * @returns {{ byKey: Map<string,string>, bySlug: Map<string,string> }} slug → app key
 */
export function buildAppSlugIndex(apps) {
  const list = Array.isArray(apps) ? apps.filter((a) => a && a.key) : [];
  const groups = new Map(); // base slug → [app]
  for (const app of list) {
    const base = slugify(app.name, app.key);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(app);
  }

  const byKey = new Map();
  const bySlug = new Map();
  for (const [base, members] of groups) {
    if (members.length === 1) {
      byKey.set(members[0].key, base);
      bySlug.set(base, members[0].key);
    } else {
      for (const app of members) {
        const suffix = String(app.key).replace(/[^a-zA-Z0-9]/g, "").slice(-5).toLowerCase() || String(members.indexOf(app));
        const unique = `${base}-${suffix}`;
        byKey.set(app.key, unique);
        if (!bySlug.has(unique)) bySlug.set(unique, app.key);
      }
    }
  }
  return { byKey, bySlug };
}

/** Public path for an app: /app/{slug} or /game/{slug}. */
export function getAppPath(app, slugIndex) {
  if (!app || !slugIndex) return "/";
  const slug = slugIndex.byKey.get(app.key);
  if (!slug) return "/";
  return `/${appTypeSegment(app)}/${slug}`;
}

// ---------- ratings (honest — never fabricated) ----------

/**
 * Average rating from real reviews. Returns null when there are no reviews
 * (a legacy numeric `rating` field is honoured only when it is > 0).
 */
export function getAverageRating(app) {
  if (!app) return null;
  const reviews = app.reviews && typeof app.reviews === "object" ? app.reviews : {};
  const values = Object.values(reviews)
    .map((r) => Number(r && r.rating))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 5);
  if (values.length) {
    return Number((values.reduce((s, n) => s + n, 0) / values.length).toFixed(1));
  }
  const legacy = Number(app.rating);
  if (Number.isFinite(legacy) && legacy > 0 && legacy <= 5) return Number(legacy.toFixed(1));
  return null;
}

export function getReviewCount(app) {
  const reviews = (app && app.reviews) || {};
  return Object.values(reviews).filter((r) => r && Number(r.rating) > 0).length;
}

export function getReviewList(app) {
  const reviews = (app && app.reviews) || {};
  return Object.entries(reviews)
    .map(([id, r]) => ({ id, ...(r || {}) }))
    .filter((r) => r && Number(r.rating) > 0)
    .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
}

// ---------- update checking (versionCode compare) ----------

/**
 * Pure comparison used by the update checker.
 * @returns {{updateAvailable:boolean, reason:'update'|'up-to-date'|'newer-installed'|'missing'}}
 */
export function resolveUpdateStatus(installedVersionCode, latestVersionCode) {
  const installed = Number(installedVersionCode);
  const latest = Number(latestVersionCode);
  if (!Number.isFinite(installed) || !Number.isFinite(latest) || latest <= 0) {
    return { updateAvailable: false, reason: "missing" };
  }
  if (latest > installed) return { updateAvailable: true, reason: "update" };
  if (latest === installed) return { updateAvailable: false, reason: "up-to-date" };
  return { updateAvailable: false, reason: "newer-installed" };
}

// ---------- app detail view-model (shared by client + SSR) ----------

function pickRelated(app, allApps, slugIndex, limit = 6) {
  const pool = (allApps || []).filter((a) => a && a.key !== app.key);
  const sameCategory = pool.filter((a) => (a.category || "Other") === (app.category || "Other"));
  const sameType = pool.filter((a) => appTypeSegment(a) === appTypeSegment(app) && !sameCategory.includes(a));
  const rest = pool.filter((a) => !sameCategory.includes(a) && !sameType.includes(a));
  const byDownloads = (arr) => [...arr].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
  return [...byDownloads(sameCategory), ...byDownloads(sameType), ...byDownloads(rest)]
    .slice(0, limit)
    .map((a) => ({ app: a, path: getAppPath(a, slugIndex) }))
    .filter((r) => r.path !== "/");
}

/**
 * Builds everything needed to render an app/game detail page — identical
 * inputs on the client and in the crawler-facing serverless function keep
 * server-rendered and client-rendered content equivalent.
 */
export function buildAppViewModel(app, opts = {}) {
  const {
    allApps = [],
    slugIndex = buildAppSlugIndex(allApps.length ? allApps : [app]),
    siteName = SITE_NAME_DEFAULT,
    origin = SITE_ORIGIN,
    isLoggedIn = false,
    userReview = null,
    installedVersionCode = null,
  } = opts;

  const slug = slugIndex.byKey.get(app.key) || slugify(app.name, app.key);
  const typeSegment = appTypeSegment(app);
  const path = `/${typeSegment}/${slug}`;
  const url = `${origin}${path}`;
  const typeLabel = typeSegment === "game" ? "Game" : "App";
  const listPath = typeSegment === "game" ? "/games" : "/apps";
  const listLabel = typeSegment === "game" ? "Games" : "Apps";
  const category = app.category || "Other";

  const avgRating = getAverageRating(app);
  const reviewList = getReviewList(app);

  const infoRows = [];
  if (app.versionName) infoRows.push({ label: "Version", value: String(app.versionName) });
  if (app.versionCode !== undefined && app.versionCode !== null && app.versionCode !== "") {
    infoRows.push({ label: "Version Code", value: String(app.versionCode) });
  }
  if (app.packageName) infoRows.push({ label: "Package Name", value: String(app.packageName) });
  infoRows.push({ label: "Category", value: category });
  const updatedTs = Number(app.updatedAt) || Number(app.createdAt) || 0;
  const updatedLabel = formatDateLabel(updatedTs);
  if (updatedLabel) infoRows.push({ label: "Last Updated", value: updatedLabel });

  let updateInfo = null;
  if (installedVersionCode !== null && app.versionCode !== undefined && app.versionCode !== null && app.versionCode !== "") {
    const status = resolveUpdateStatus(installedVersionCode, app.versionCode);
    if (status.updateAvailable) {
      updateInfo = {
        installedVersionCode: Number(installedVersionCode),
        latestVersionCode: Number(app.versionCode),
        latestVersionName: app.versionName ? String(app.versionName) : "",
      };
    }
  }

  const description = String(app.description || "").trim();
  const metaDescription = description
    ? truncateText(description, 158)
    : `Download ${app.name || "this " + typeLabel.toLowerCase()} (${category}) free on ${siteName}. Ratings, screenshots and one-tap download — no login required.`;

  return {
    app,
    slug,
    typeSegment,
    typeLabel,
    listPath,
    listLabel,
    category,
    path,
    url,
    siteName,
    origin,
    isLoggedIn,
    userReview,
    avgRating,
    reviewCount: reviewList.length,
    reviews: reviewList.slice(0, 20),
    downloads: Number(app.downloads) || 0,
    infoRows,
    updatedTs,
    updatedLabel,
    updateInfo,
    related: pickRelated(app, allApps, slugIndex),
    screenshots: [app.screenshot1, app.screenshot2, app.screenshot3, app.screenshot4, app.screenshot5].filter(
      (u) => typeof u === "string" && u.startsWith("http")
    ),
    title: `${app.name || typeLabel} — Free ${typeLabel} Download | ${siteName}`,
    metaDescription,
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: listLabel, href: listPath },
      // Skip the category level when it duplicates the list level (e.g. category "Games" on /games)
      ...(category && category !== listLabel
        ? [{ name: category, href: `${listPath}?category=${encodeURIComponent(category)}` }]
        : []),
      { name: app.name || typeLabel, href: path },
    ],
  };
}

// ---------- shared HTML renderers ----------

function iconHtml(app, shellClass, extraAttrs = "") {
  const name = escapeHtml(app.name || "App");
  if (app.imageUrl && String(app.imageUrl).startsWith("http")) {
    return `
      <div class="${shellClass}">
        <img src="${escapeHtml(app.imageUrl)}" alt="${name} icon" width="64" height="64" ${extraAttrs} onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
        <span style="display:none">${escapeHtml(app.icon || "📱")}</span>
      </div>`;
  }
  return `<div class="${shellClass}"><span>${escapeHtml(app.icon || "📱")}</span></div>`;
}

/** Compact app card used in every grid (real crawlable link). */
export function appCardHtml(app, path) {
  const avg = getAverageRating(app);
  const ratingLabel = avg === null ? "New" : `★ ${avg}`;
  const desc = String(app.description || "No description available.");
  return `
    <a class="app-card" href="${escapeHtml(path)}" data-nav aria-label="${escapeHtml(app.name || "App")} — view details">
      <div class="app-card-head">
        ${iconHtml(app, "app-icon-shell", 'width="44" height="44" loading="lazy" decoding="async"')}
        <div class="app-card-titles">
          <h3 class="app-name">${escapeHtml(app.name)}</h3>
          <div class="app-category">${escapeHtml(app.category || "App")}</div>
        </div>
      </div>
      <div class="app-rating">
        <span>${ratingLabel}</span>
        <span>${formatCountLabel(app.downloads)} downloads</span>
      </div>
      <p class="app-desc-snippet">${escapeHtml(desc.slice(0, 110))}${desc.length > 110 ? "…" : ""}</p>
      <span class="app-download-btn">View &amp; Download</span>
    </a>`;
}

export function formatCountLabel(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function starsHtml(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return `${"★".repeat(r)}${"☆".repeat(5 - r)}`;
}

/**
 * Full inner markup for #appDetailPageContent — used by the client router AND
 * the crawler-facing SSR function so both render identical content.
 */
export function renderAppDetailInner(vm) {
  const app = vm.app;
  const name = escapeHtml(app.name || "App");
  const hasLink = typeof app.link === "string" && /^https?:\/\//i.test(app.link);

  const breadcrumbHtml = `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        ${vm.breadcrumb
          .map((crumb, i) => {
            const last = i === vm.breadcrumb.length - 1;
            return last
              ? `<li aria-current="page"><span>${escapeHtml(crumb.name)}</span></li>`
              : `<li><a href="${escapeHtml(crumb.href)}" data-nav>${escapeHtml(crumb.name)}</a></li>`;
          })
          .join("")}
      </ol>
    </nav>`;

  const updateBannerHtml = vm.updateInfo
    ? `
    <div class="update-banner" role="status">
      <strong>⬆️ Update available for ${name}</strong>
      <span>Installed version code ${vm.updateInfo.installedVersionCode} → latest ${vm.updateInfo.latestVersionCode}${
        vm.updateInfo.latestVersionName ? ` (${escapeHtml(vm.updateInfo.latestVersionName)})` : ""
      }. Download the newest version below.</span>
    </div>`
    : "";

  const ratingStat = vm.avgRating === null ? "New" : `★ ${vm.avgRating}`;

  const infoHtml = vm.infoRows.length
    ? `
    <dl class="app-info-table">
      ${vm.infoRows.map((row) => `<div class="app-info-row"><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}
    </dl>`
    : "";

  const screenshotsHtml = vm.screenshots.length
    ? `
    <div class="screenshots-section">
      <h2 class="screenshots-label">${escapeHtml(app.name || "App")} screenshots</h2>
      <div class="screenshots-scroll">
        ${vm.screenshots
          .map(
            (url, i) =>
              `<img src="${escapeHtml(url)}" class="screenshot-thumb" width="100" height="175" loading="${i < 2 ? "eager" : "lazy"}" decoding="async" alt="${name} — screenshot ${i + 1}" onclick='openScreenshot(${JSON.stringify(String(url))})' onerror="this.style.display='none'">`
          )
          .join("")}
      </div>
    </div>`
    : "";

  const reviewFormHtml = vm.isLoggedIn
    ? `
    <div class="rating-section">
      <h2 class="section-block-title">Rate this ${escapeHtml(vm.typeLabel)}</h2>
      <div class="stars" role="radiogroup" aria-label="Select a star rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (v) =>
              `<button type="button" class="star ${(vm.userReview && Number(vm.userReview.rating) >= v) || (!vm.userReview && false) ? "active" : ""}" aria-label="${v} star${v > 1 ? "s" : ""}" onclick='setRating(${v})'>★</button>`
          )
          .join("")}
      </div>
      <div class="input-group" style="margin-top:12px;">
        <label for="reviewText">Write a Review</label>
        <textarea id="reviewText" rows="3" placeholder="Share your experience...">${
          vm.userReview ? escapeHtml(vm.userReview.comment || "") : ""
        }</textarea>
      </div>
      <button class="btn btn-outline btn-sm" onclick='submitReview(${JSON.stringify(String(app.name || "App"))})'>📝 Submit Review</button>
    </div>`
    : `
    <div class="rating-section">
      <h2 class="section-block-title">Rate this ${escapeHtml(vm.typeLabel)}</h2>
      <div class="login-gate-card">
        <p>⭐ Downloads are open to everyone — <strong>no login needed</strong>. To rate or review ${name}, please log in or create a free account.</p>
        <div class="login-gate-actions">
          <a class="btn btn-primary btn-sm" href="/login" data-auth-nav>🔑 Login / Sign Up</a>
          <span class="login-gate-hint">Reviews keep the store honest — yours helps others decide.</span>
        </div>
      </div>
    </div>`;

  const reviewsHtml = vm.reviews.length
    ? vm.reviews
        .map(
          (r) => `
        <div class="review-item">
          <div class="review-user">${escapeHtml(r.username || "Anonymous")}</div>
          <div class="review-rating" aria-label="${Number(r.rating) || 0} out of 5 stars">${starsHtml(r.rating)}</div>
          <div class="review-text">${escapeHtml(r.comment || "")}</div>
          <div class="review-date">${escapeHtml(formatDateLabel(r.date) || "")}</div>
        </div>`
        )
        .join("")
    : `<div class="empty-state" style="min-height:auto">No reviews yet. Be the first to review!</div>`;

  const relatedHtml = vm.related.length
    ? `
    <div class="related-section">
      <h2 class="section-block-title">Related ${escapeHtml(vm.listLabel)}</h2>
      <div class="apps-grid">
        ${vm.related.map((r) => appCardHtml(r.app, r.path)).join("")}
      </div>
    </div>`
    : "";

  const downloadHtml = hasLink
    ? `<a class="btn btn-primary" href="${escapeHtml(app.link)}" target="_blank" rel="noopener" onclick='return handleDownloadClick(event, ${JSON.stringify(String(app.key))}, ${JSON.stringify(String(app.link))})'>${
        vm.updateInfo ? "⬆️ Update Now" : "⬇️ Download Now"
      }</a>`
    : `<button class="btn btn-primary" disabled title="Download link not available yet">⬇️ Download unavailable</button>`;

  return `
    ${breadcrumbHtml}
    <div class="app-detail-layout">
      <div class="app-detail-hero">
        ${iconHtml(app, "detail-icon-shell")}
        <div class="app-detail-heading">
          <span class="chip">${escapeHtml(vm.category)}</span>
          <h1 class="app-detail-name">${name}</h1>
          <p class="app-detail-subline">Free ${escapeHtml(vm.typeLabel.toLowerCase())} download — browse, review and install without an account.</p>
          <div class="app-stats">
            <div class="app-stat"><span class="app-stat-value">${ratingStat}</span><span class="app-stat-label">Average Rating</span></div>
            <div class="app-stat"><span class="app-stat-value">${formatCountLabel(vm.downloads)}</span><span class="app-stat-label">Downloads</span></div>
            <div class="app-stat"><span class="app-stat-value">${vm.reviewCount}</span><span class="app-stat-label">Reviews</span></div>
          </div>
        </div>
      </div>

      ${updateBannerHtml}

      ${infoHtml}

      <div class="app-desc">${escapeHtml(app.description || "No description available.")}</div>

      <div class="detail-actions">
        ${downloadHtml}
        <button class="btn btn-ghost" onclick="openReport()">Need help?</button>
      </div>
      <p class="detail-note">✅ No login needed to download. Login is only required to submit reviews, ratings and reports.</p>

      ${screenshotsHtml}

      ${reviewFormHtml}

      <div class="reviews-block">
        <h2 class="section-block-title">User Reviews (${vm.reviewCount})</h2>
        <div class="reviews-list">${reviewsHtml}</div>
      </div>

      ${relatedHtml}

      <div class="ad-slot hidden" data-ad-slot="detail_bottom"></div>
    </div>`;
}

/** Shown for /app/… and /game/… slugs that do not match any real record. */
export function renderNotFoundInner(typeLabel = "App") {
  return `
    <div class="not-found-block empty-state">
      <h1 class="not-found-title">😕 ${escapeHtml(typeLabel)} not found</h1>
      <p>The ${escapeHtml(typeLabel.toLowerCase())} you are looking for does not exist (or was removed). Nothing to index here.</p>
      <div class="not-found-actions">
        <a class="btn btn-primary" href="/apps" data-nav>📱 Browse Apps</a>
        <a class="btn btn-ghost" href="/games" data-nav>🎮 Browse Games</a>
        <a class="btn btn-ghost" href="/" data-nav>🏠 Home</a>
      </div>
    </div>`;
}

// ---------- JSON-LD builders (real data only) ----------

export function homeJsonLd(siteName = SITE_NAME_DEFAULT) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: siteName,
        url: `${SITE_ORIGIN}/`,
        description: HOME_META.description,
        inLanguage: "en",
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: siteName,
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/icons/icon-512.png`,
        email: "abusayem0866@gmail.com",
        address: { "@type": "PostalAddress", addressCountry: "BD" },
        founder: { "@type": "Person", name: "Md. Abu Sayem" },
      },
    ],
  };
}

export function appJsonLd(vm) {
  const app = vm.app;
  const softwareApplication = {
    "@type": "SoftwareApplication",
    name: app.name || vm.typeLabel,
    url: vm.url,
    description: vm.metaDescription,
    isAccessibleForFree: true,
    applicationCategory: vm.category,
    operatingSystem: /apk|android/i.test(String(app.link || "")) || /android/i.test(String(app.description || "")) ? "Android" : undefined,
  };

  const images = [];
  if (app.imageUrl && String(app.imageUrl).startsWith("http")) images.push(String(app.imageUrl));
  vm.screenshots.forEach((s) => images.push(s));
  if (images.length) softwareApplication.image = images;

  if (app.versionName) softwareApplication.softwareVersion = String(app.versionName);
  if (app.packageName) {
    softwareApplication.identifier = { "@type": "PropertyValue", name: "package", value: String(app.packageName) };
  }
  if (typeof app.link === "string" && /^https?:\/\//i.test(app.link)) softwareApplication.downloadUrl = String(app.link);
  if (vm.updatedTs) softwareApplication.dateModified = new Date(vm.updatedTs).toISOString();

  // Aggregate rating ONLY from real reviews — never fabricated.
  if (vm.reviewCount > 0 && vm.avgRating !== null) {
    softwareApplication.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: vm.avgRating,
      reviewCount: vm.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
    softwareApplication.review = vm.reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: String(r.username || "Anonymous") },
      reviewRating: { "@type": "Rating", ratingValue: Number(r.rating) || 0, bestRating: 5, worstRating: 1 },
      reviewBody: String(r.comment || "").slice(0, 500) || undefined,
      datePublished: Number(r.date) ? new Date(Number(r.date)).toISOString().slice(0, 10) : undefined,
    }));
  }

  // Strip undefined values so JSON stays clean
  const clean = (obj) => JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v)), (_k, v) => (v === null ? undefined : v));

  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website` },
      clean(softwareApplication),
      {
        "@type": "WebPage",
        url: vm.url,
        name: vm.title,
        description: vm.metaDescription,
        isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: vm.breadcrumb.map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.name,
            item: i === vm.breadcrumb.length - 1 ? undefined : `${SITE_ORIGIN}${c.href}`,
          })),
        },
      },
    ],
  };
}

// ---------- sitemap ----------

/**
 * Builds sitemap XML from real app records. lastmod is emitted ONLY when the
 * record carries a real timestamp (updatedAt/createdAt) — never invented.
 */
export function buildSitemapXml(apps, staticUrls = null) {
  const slugIndex = buildAppSlugIndex(apps || []);
  const pages = Array.isArray(staticUrls) && staticUrls.length
    ? staticUrls
    : [
        { loc: "/", priority: "1.0", changefreq: "daily" },
        { loc: "/apps", priority: "0.9", changefreq: "daily" },
        { loc: "/games", priority: "0.9", changefreq: "daily" },
        { loc: "/search", priority: "0.4", changefreq: "weekly" },
        { loc: "/faq", priority: "0.3", changefreq: "monthly" },
        { loc: "/terms", priority: "0.3", changefreq: "monthly" },
        { loc: "/privacy", priority: "0.3", changefreq: "monthly" },
        { loc: "/disclaimer", priority: "0.3", changefreq: "monthly" },
      ];

  const urls = pages.map((p) => {
    const lastmod = p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : "";
    return `  <url>\n    <loc>${escapeHtml(SITE_ORIGIN + p.loc)}</loc>${lastmod}\n    <changefreq>${p.changefreq || "weekly"}</changefreq>\n    <priority>${p.priority || "0.5"}</priority>\n  </url>`;
  });

  for (const app of apps || []) {
    const path = getAppPath(app, slugIndex);
    if (path === "/") continue;
    const ts = Number(app.updatedAt) || Number(app.createdAt) || 0;
    const lastmod = ts ? `\n    <lastmod>${new Date(ts).toISOString().slice(0, 10)}</lastmod>` : "";
    urls.push(
      `  <url>\n    <loc>${escapeHtml(SITE_ORIGIN + path)}</loc>${lastmod}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
