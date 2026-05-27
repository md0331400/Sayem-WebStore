import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, get, remove, update, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDo4VtvFjkHK_qPKw_8OvjWB3DF93m0_vE",
  authDomain: "samva-app-store.firebaseapp.com",
  databaseURL: "https://samva-app-store-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "samva-app-store",
  storageBucket: "samva-app-store.firebasestorage.app",
  messagingSenderId: "42570449631",
  appId: "1:42570449631:web:0c81be27dc888a97db9f6a"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
window._db = db;
window._ref = ref;
window._push = push;
window._set = set;
window._get = get;
window._remove = remove;
window._update = update;
window._onValue = onValue;
window._runTransaction = runTransaction;

const DEFAULT_WEBSITE_NAME = "SamWeb Store";
const DEFAULT_LOGO = "icons/icon-192.png";
const CACHE_KEYS = {
  apps: "samweb_cached_apps_v3",
  settings: "samweb_cached_settings_v2",
  installDismissed: "samweb_install_banner_dismissed"
};

let currentUser = null;
let selectedGender = "Male";
let allApps = [];
let firebaseReady = false;
let currentAppId = null;
let selectedRatingValue = 0;
let apkDownloadLink = null;
let deferredInstallPrompt = null;
let appsSubscribed = false;
let activeCategory = "All";

const $ = (id) => document.getElementById(id);

function toast(msg, type = "info", dur = 3000) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.className = "";
  }, dur);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNum(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function toJsString(value) {
  return JSON.stringify(String(value ?? ""));
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function getStoredJson(key, fallback) {
  try {
    return safeJsonParse(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function setStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getCachedApps() {
  const cached = getStoredJson(CACHE_KEYS.apps, []);
  return Array.isArray(cached) ? cached : [];
}

function cacheApps(apps) {
  setStoredJson(CACHE_KEYS.apps, apps);
}

function getCachedSettings() {
  const cached = getStoredJson(CACHE_KEYS.settings, {});
  return cached && typeof cached === "object" ? cached : {};
}

function cacheSettings(settings) {
  const previous = getCachedSettings();
  setStoredJson(CACHE_KEYS.settings, { ...previous, ...settings });
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
}

function isSafariBrowser() {
  const ua = window.navigator.userAgent || "";
  return /safari/i.test(ua) && !/chrome|crios|android|edg/i.test(ua);
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function canShowInstallUI() {
  return !isStandaloneMode();
}

function applyWebsiteName(name) {
  const finalName = (name || DEFAULT_WEBSITE_NAME).trim() || DEFAULT_WEBSITE_NAME;
  const websiteName = $("websiteName");
  const footerBrandName = $("footerBrandName");
  if (websiteName) websiteName.textContent = finalName;
  if (footerBrandName) footerBrandName.textContent = finalName;
  document.querySelectorAll(".auth-logo-title, .side-menu-logo").forEach((el) => {
    el.textContent = finalName;
  });
  document.title = `${finalName} | Cross-Platform PWA App Store`;
}

function applyLogo(url) {
  const finalUrl = url || DEFAULT_LOGO;
  const pairs = [
    ["headerLogoImg", "headerLogoEmoji"],
    ["authLogoImg", "authLogoIcon"],
    ["aboutLogoImg", "aboutLogoEmoji"]
  ];

  pairs.forEach(([imgId, fallbackId]) => {
    const img = $(imgId);
    const fallback = $(fallbackId);
    if (!img) return;

    img.onerror = () => {
      img.style.display = "none";
      if (fallback) fallback.classList.remove("hidden");
    };

    img.src = finalUrl;
    img.style.display = "block";
    if (fallback) fallback.classList.add("hidden");
  });
}

function getSavedWebsiteName() {
  try {
    return localStorage.getItem("website_name") || "";
  } catch {
    return "";
  }
}

function hydrateFromCache() {
  const settings = getCachedSettings();
  applyWebsiteName(getSavedWebsiteName() || settings.websiteName || DEFAULT_WEBSITE_NAME);
  applyLogo(settings.logoUrl || DEFAULT_LOGO);
  if (settings.apkDownloadLink) apkDownloadLink = settings.apkDownloadLink;

  const cachedApps = getCachedApps();
  if (cachedApps.length) {
    allApps = cachedApps;
    renderApps(applyAppFilters());
  }
}

function updateConnectionState() {
  const online = navigator.onLine;
  const pill = $("networkPill");
  const hint = $("installHint");
  if (pill) {
    pill.className = `network-pill ${online ? "online" : "offline"}`;
    pill.textContent = online ? "Online • synced" : "Offline • cached mode";
  }
  if (hint) {
    hint.textContent = online
      ? "Install once and revisit with a fast offline-ready experience."
      : "You are offline. Cached content will remain available when possible.";
  }
}

function updateInstallUI() {
  const shouldShow = canShowInstallUI();
  const dismissed = sessionStorage.getItem(CACHE_KEYS.installDismissed) === "1";
  const label = deferredInstallPrompt
    ? "Install App"
    : isIOS()
    ? "Add to Home Screen"
    : isSafariBrowser()
    ? "Add to Dock"
    : "Install App";

  ["installBtn", "heroInstallBtn", "footerInstallBtn", "bannerInstallBtn"].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.textContent = label;
    btn.classList.toggle("hidden", !shouldShow);
  });

  const banner = $("installBanner");
  const bannerText = $("installBannerText");
  if (bannerText) {
    if (deferredInstallPrompt) {
      bannerText.textContent = "Install this PWA for an app-like experience with cached offline access.";
    } else if (isIOS()) {
      bannerText.textContent = "On iPhone or iPad, tap Share and choose “Add to Home Screen”.";
    } else if (isSafariBrowser()) {
      bannerText.textContent = "In Safari, use Share and select “Add to Dock” to install the app.";
    } else {
      bannerText.textContent = "Use your browser install option for quick access and offline-ready performance.";
    }
  }

  if (banner) {
    banner.classList.toggle("hidden", !shouldShow || dismissed);
  }

  buildSideMenu();
}

function dismissInstallBanner() {
  sessionStorage.setItem(CACHE_KEYS.installDismissed, "1");
  updateInstallUI();
}
window.dismissInstallBanner = dismissInstallBanner;

async function triggerInstallPrompt() {
  closeMenu();

  if (isStandaloneMode()) {
    toast("App is already installed on this device.", "success");
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === "accepted") {
      toast("Thanks for installing SamWeb Store!", "success");
      sessionStorage.setItem(CACHE_KEYS.installDismissed, "1");
    } else {
      toast("Installation was dismissed.", "info");
    }
    deferredInstallPrompt = null;
    updateInstallUI();
    return;
  }

  if (isIOS()) {
    toast("On iPhone/iPad: tap Share and choose “Add to Home Screen”.", "info", 4200);
    return;
  }

  if (isSafariBrowser()) {
    toast("In Safari: open Share and choose “Add to Dock”.", "info", 4200);
    return;
  }

  toast("Use your browser menu and choose “Install app”.", "info", 3600);
}
window.triggerInstallPrompt = triggerInstallPrompt;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch((err) => {
    console.warn("Service worker registration failed:", err);
  });
}

function createParticles() {
  const wrap = $("particles");
  if (!wrap) return;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = Math.random() * 7 + 3;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDuration = `${Math.random() * 12 + 10}s`;
    p.style.animationDelay = `${Math.random() * 8}s`;
    wrap.appendChild(p);
  }
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  const page = $(id);
  if (page) page.classList.add("active");
  closeMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id === "homePage") loadApps();
}
window.showPage = showPage;

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.scrollToTop = scrollToTop;

function navigateToSection(sectionId) {
  if (!$("homePage")?.classList.contains("active")) showPage("homePage");
  setTimeout(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}
window.navigateToSection = navigateToSection;

function scrollToApps() {
  navigateToSection("appsSection");
}
window.scrollToApps = scrollToApps;

function openMenu() {
  $("sideMenu")?.classList.add("open");
  $("sideOverlay")?.classList.add("open");
  document.body.classList.add("menu-open");
}
window.openMenu = openMenu;

function closeMenu() {
  $("sideMenu")?.classList.remove("open");
  $("sideOverlay")?.classList.remove("open");
  document.body.classList.remove("menu-open");
}
window.closeMenu = closeMenu;

function loadSession() {
  try {
    const saved = localStorage.getItem("samweb_user");
    if (saved) {
      currentUser = JSON.parse(saved);
      window.currentUser = currentUser;
    }
  } catch {
    currentUser = null;
    window.currentUser = null;
  }
  updateHeaderUser();
  buildSideMenu();
}

function saveSession(user) {
  currentUser = user;
  window.currentUser = user;
  localStorage.setItem("samweb_user", JSON.stringify(user));
  updateHeaderUser();
  buildSideMenu();
  recordVisit();
}

function clearSession() {
  currentUser = null;
  window.currentUser = null;
  localStorage.removeItem("samweb_user");
  updateHeaderUser();
  buildSideMenu();
}

function updateHeaderUser() {
  const headerUser = $("headerUser");
  const authBtn = $("headerLoginBtn");

  if (currentUser) {
    if (headerUser) {
      headerUser.style.display = "block";
      headerUser.textContent = `👤 ${(currentUser.name || "User").split(" ")[0]}`;
    }
    if (authBtn) authBtn.classList.add("hidden");
  } else {
    if (headerUser) headerUser.style.display = "none";
    if (authBtn) authBtn.classList.remove("hidden");
  }
}

function buildSideMenu() {
  const nav = $("sideNav");
  const footer = $("sideFooter");
  if (!nav || !footer) return;

  const installLabel = deferredInstallPrompt
    ? "Install App"
    : isIOS()
    ? "Add to Home Screen"
    : isSafariBrowser()
    ? "Add to Dock"
    : "Install App";

  nav.innerHTML = "";
  footer.innerHTML = "";

  const items = [
    { label: "Home", icon: "🏠", action: () => navigateToSection("homePage") },
    { label: "Featured", icon: "✨", action: () => navigateToSection("featuredSection") },
    { label: "All Apps", icon: "🧩", action: () => navigateToSection("appsSection") },
    { label: "Report Us", icon: "📣", action: openReport },
    { label: "About", icon: "ℹ️", action: openAbout }
  ];

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.innerHTML = `<span class="nav-icon">${item.icon}</span>${item.label}`;
    btn.onclick = () => {
      item.action();
      closeMenu();
    };
    nav.appendChild(btn);
  });

  if (canShowInstallUI()) {
    const installBtn = document.createElement("button");
    installBtn.className = "nav-item";
    installBtn.innerHTML = `<span class="nav-icon">⬇️</span>${installLabel}`;
    installBtn.onclick = () => triggerInstallPrompt();
    nav.appendChild(installBtn);
  }

  if (apkDownloadLink) {
    const apkBtn = document.createElement("button");
    apkBtn.className = "nav-item-apk";
    apkBtn.innerHTML = '<span class="nav-icon">📦</span>Download Android APK';
    apkBtn.onclick = openApkDownload;
    nav.appendChild(apkBtn);
  }

  if (currentUser) {
    footer.innerHTML = `
      <div class="side-user-info">
        <div class="side-avatar">${escapeHtml((currentUser.name || "U")[0].toUpperCase())}</div>
        <div>
          <div class="side-user-name">${escapeHtml(currentUser.name || "User")}</div>
          <div class="side-user-email">${escapeHtml(currentUser.email || currentUser.number || "")}</div>
        </div>
      </div>
      <button class="btn btn-danger btn-full btn-sm" onclick="doLogout()">🚪 Logout</button>
    `;
  } else {
    footer.innerHTML = '<button class="btn btn-primary btn-full" onclick="showPage(\'authPage\'); closeMenu();">🔑 Login / Sign Up</button>';
  }
}

function switchAuth(tab) {
  const tabs = document.querySelectorAll(".auth-tab");
  if (tabs.length >= 2) {
    tabs[0].classList.toggle("active", tab === "login");
    tabs[1].classList.toggle("active", tab === "signup");
  }
  $("loginForm")?.classList.toggle("active", tab === "login");
  $("signupForm")?.classList.toggle("active", tab === "signup");
  $("signupError")?.classList.remove("show");
}
window.switchAuth = switchAuth;

function selectGender(gender, el) {
  selectedGender = gender;
  document.querySelectorAll(".gender-opt").forEach((x) => x.classList.remove("selected"));
  el.classList.add("selected");
}
window.selectGender = selectGender;

async function doLogin() {
  const identifier = $("loginEmail")?.value.trim();
  const pass = $("loginPass")?.value;
  if (!identifier || !pass) {
    toast("Please fill all fields", "error");
    return;
  }
  if (!firebaseReady) {
    toast("Connecting to database...", "info");
    return;
  }

  try {
    const snap = await window._get(window._ref(window._db, "users"));
    if (snap.exists()) {
      let found = null;
      snap.forEach((child) => {
        const u = child.val();
        if ((u.email === identifier || u.number === identifier) && u.password === pass) {
          found = { ...u, key: child.key };
        }
      });
      if (found) {
        saveSession(found);
        toast(`Welcome back, ${found.name || "User"}! 🎉`, "success");
        showPage("homePage");
      } else {
        toast("Invalid credentials!", "error");
      }
    } else {
      toast("No users found. Please sign up!", "error");
    }
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}
window.doLogin = doLogin;

async function doSignup() {
  const name = $("signName")?.value.trim();
  const email = $("signEmail")?.value.trim();
  const phone = $("signPhone")?.value.trim();
  const pass = $("signPass")?.value;
  const errorDiv = $("signupError");

  if (errorDiv) {
    errorDiv.innerHTML = "";
    errorDiv.classList.remove("show");
  }

  if (!name || !email || !phone || !pass) {
    if (errorDiv) {
      errorDiv.innerHTML = "❌ Please fill all fields!";
      errorDiv.classList.add("show");
    }
    return;
  }

  if (pass.length < 6) {
    if (errorDiv) {
      errorDiv.innerHTML = "❌ Password must be at least 6 characters!";
      errorDiv.classList.add("show");
    }
    return;
  }

  if (!firebaseReady) {
    toast("Connecting to database...", "info");
    return;
  }

  try {
    const snap = await window._get(window._ref(window._db, "users"));
    let emailExists = false;
    let phoneExists = false;
    if (snap.exists()) {
      snap.forEach((child) => {
        const u = child.val();
        if (u.email === email) emailExists = true;
        if (u.number === phone) phoneExists = true;
      });
    }

    if (emailExists) {
      if (errorDiv) {
        errorDiv.innerHTML = "❌ This email is already registered!";
        errorDiv.classList.add("show");
      }
      return;
    }

    if (phoneExists) {
      if (errorDiv) {
        errorDiv.innerHTML = "❌ This phone number is already registered!";
        errorDiv.classList.add("show");
      }
      return;
    }

    const newRef = window._push(window._ref(window._db, "users"));
    const userData = { name, email, number: phone, password: pass, gender: selectedGender };
    await window._set(newRef, userData);
    saveSession({ ...userData, key: newRef.key });
    toast(`Account created! Welcome ${name} 🎉`, "success");
    showPage("homePage");
  } catch (e) {
    if (errorDiv) {
      errorDiv.innerHTML = `❌ Error: ${e.message}`;
      errorDiv.classList.add("show");
    }
  }
}
window.doSignup = doSignup;

function doLogout() {
  clearSession();
  toast("Logged out successfully", "success");
  showPage("homePage");
  setTimeout(recordVisit, 500);
}
window.doLogout = doLogout;

function getDeviceToken() {
  const KEY = "samweb_device_token_v2";
  let token = localStorage.getItem(KEY);
  if (!token) {
    const rand = Math.random().toString(36).substr(2, 9);
    const ts = Date.now().toString(36);
    token = `dt_${rand}${ts}`;
    localStorage.setItem(KEY, token);
  }
  return token;
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let deviceName = "Unknown";
  let deviceType = "desktop";
  let browser = "Unknown";

  if (/Android/i.test(ua)) {
    const m = ua.match(/;\s([^;]+)\sBuild/);
    deviceName = m ? m[1] : "Android";
    deviceType = "mobile";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    deviceName = "Apple Device";
    deviceType = "mobile";
  } else if (/Windows/i.test(ua)) {
    deviceName = "Windows PC";
  } else if (/Mac/i.test(ua)) {
    deviceName = "Mac";
  }

  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";

  return {
    deviceName,
    deviceType,
    browser,
    platform: navigator.platform || "Unknown",
    language: navigator.language || "Unknown",
    screen: `${window.screen.width}x${window.screen.height}`,
    ram: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Unknown",
    cpuCores: navigator.hardwareConcurrency || "Unknown",
    userAgent: ua
  };
}

function getConnectionInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    return {
      effectiveType: conn.effectiveType || "Unknown",
      downlink: conn.downlink ? `${conn.downlink} Mbps` : "Unknown",
      rtt: conn.rtt ? `${conn.rtt} ms` : "Unknown"
    };
  }
  return { effectiveType: "Unknown", downlink: "Unknown", rtt: "Unknown" };
}

async function getBatteryInfo() {
  try {
    const bt = await navigator.getBattery();
    return {
      level: `${Math.round(bt.level * 100)}%`,
      charging: bt.charging ? "⚡ Charging" : "🔋 Battery"
    };
  } catch {
    return { level: "N/A", charging: "N/A" };
  }
}

async function getIP() {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    return (await r.json()).ip;
  } catch {
    return null;
  }
}

async function recordVisit() {
  if (!firebaseReady) {
    setTimeout(recordVisit, 1000);
    return;
  }

  try {
    const deviceToken = getDeviceToken();
    const di = getDeviceInfo();
    const conn = getConnectionInfo();
    const battery = await getBatteryInfo();
    const ip = await getIP();
    const now = Date.now();

    const visitorRef = window._ref(window._db, `visitors/${deviceToken}`);
    const snap = await window._get(visitorRef);
    const existing = snap.exists() ? snap.val() : {};

    const visitEntry = {
      timestamp: now,
      ip: ip || "N/A",
      browser: di.browser,
      platform: di.platform,
      language: di.language,
      screenResolution: di.screen,
      ram: di.ram,
      cpuCores: di.cpuCores,
      connectionType: conn.effectiveType,
      connectionSpeed: conn.downlink,
      batteryLevel: battery.level,
      batteryStatus: battery.charging,
      userAgent: di.userAgent
    };

    let history = existing.visitHistory || [];
    if (!Array.isArray(history)) history = Object.values(history).filter(Boolean);
    history.unshift(visitEntry);
    if (history.length > 20) history = history.slice(0, 20);

    const visitorData = {
      deviceToken,
      deviceName: di.deviceName,
      deviceType: di.deviceType,
      browser: di.browser,
      platform: di.platform,
      language: di.language,
      screenResolution: di.screen,
      ram: di.ram,
      cpuCores: di.cpuCores,
      ip: ip || existing.ip || "N/A",
      battery: battery.level,
      batteryStatus: battery.charging,
      lastVisit: now,
      visitCount: (existing.visitCount || 0) + 1,
      visitHistory: history,
      firstVisit: existing.firstVisit || now
    };

    if (currentUser) {
      visitorData.userId = currentUser.key || "";
      visitorData.userName = currentUser.name || "User";
      visitorData.userEmail = currentUser.email || "";
      visitorData.userPhone = currentUser.number || "";
      visitorData.userGender = currentUser.gender || "";
    } else if (existing.userName) {
      visitorData.userId = existing.userId || "";
      visitorData.userName = existing.userName;
      visitorData.userEmail = existing.userEmail || "";
      visitorData.userPhone = existing.userPhone || "";
      visitorData.userGender = existing.userGender || "";
    }

    await window._set(visitorRef, visitorData);
  } catch (e) {
    console.error("Visit recording error:", e);
  }
}

async function loadWebsiteSettings() {
  const cached = getCachedSettings();
  applyWebsiteName(getSavedWebsiteName() || cached.websiteName || DEFAULT_WEBSITE_NAME);
  applyLogo(cached.logoUrl || DEFAULT_LOGO);
  apkDownloadLink = cached.apkDownloadLink || apkDownloadLink;

  if (!firebaseReady) {
    buildSideMenu();
    return;
  }

  try {
    const [apkSnap, logoSnap] = await Promise.all([
      window._get(window._ref(window._db, "settings/apkDownloadLink")),
      window._get(window._ref(window._db, "settings/logoUrl"))
    ]);

    apkDownloadLink = apkSnap.exists() && apkSnap.val() ? apkSnap.val() : null;
    const logoUrl = logoSnap.exists() && logoSnap.val() ? logoSnap.val() : null;

    applyLogo(logoUrl || DEFAULT_LOGO);
    cacheSettings({
      websiteName: getSavedWebsiteName() || DEFAULT_WEBSITE_NAME,
      logoUrl: logoUrl || DEFAULT_LOGO,
      apkDownloadLink: apkDownloadLink || null
    });
  } catch (e) {
    console.warn("Website settings load error:", e);
  }

  buildSideMenu();
}

function getAverageRating(app) {
  if (!app.reviews || Object.keys(app.reviews).length === 0) return Number(app.rating || 4.5);
  let total = 0;
  let count = 0;
  for (const key in app.reviews) {
    if (app.reviews[key] && app.reviews[key].rating) {
      total += app.reviews[key].rating;
      count += 1;
    }
  }
  if (count === 0) return Number(app.rating || 4.5);
  return Number((total / count).toFixed(1));
}

function getCardIconHtml(app, shellClass = "app-icon-shell") {
  if (app.imageUrl && app.imageUrl.startsWith("http")) {
    return `
      <div class="${shellClass}">
        <img src="${escapeHtml(app.imageUrl)}" alt="${escapeHtml(app.name || "App")} icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
        <span style="display:none">${escapeHtml(app.icon || "📱")}</span>
      </div>
    `;
  }
  return `<div class="${shellClass}"><span>${escapeHtml(app.icon || "📱")}</span></div>`;
}

function getFeaturedApps(source = allApps) {
  return [...source]
    .sort((a, b) => {
      const dl = (b.downloads || 0) - (a.downloads || 0);
      if (dl !== 0) return dl;
      return getAverageRating(b) - getAverageRating(a);
    })
    .slice(0, 4);
}

function updateHeroMetrics(source = allApps) {
  const totalApps = source.length;
  const totalDownloads = source.reduce((sum, app) => sum + (Number(app.downloads) || 0), 0);
  const totalRatings = source.length
    ? (source.reduce((sum, app) => sum + getAverageRating(app), 0) / source.length).toFixed(1)
    : "0.0";

  if ($("heroAppsCount")) $("heroAppsCount").textContent = formatNum(totalApps);
  if ($("heroDownloadsCount")) $("heroDownloadsCount").textContent = formatNum(totalDownloads);
  if ($("heroRatingCount")) $("heroRatingCount").textContent = totalRatings;
}

function renderHeroMiniList(source = allApps) {
  const wrap = $("heroMiniList");
  if (!wrap) return;

  const featured = getFeaturedApps(source).slice(0, 3);
  if (!featured.length) {
    wrap.innerHTML = '<div class="mini-placeholder">Curated app highlights will appear here once apps are available.</div>';
    return;
  }

  wrap.innerHTML = featured
    .map((app) => `
      <div class="mini-app">
        <div class="mini-app-icon">
          ${app.imageUrl && app.imageUrl.startsWith("http")
            ? `<img src="${escapeHtml(app.imageUrl)}" alt="${escapeHtml(app.name)} icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"><span style="display:none">${escapeHtml(app.icon || "📱")}</span>`
            : `<span>${escapeHtml(app.icon || "📱")}</span>`}
        </div>
        <div class="mini-app-meta">
          <strong>${escapeHtml(app.name)}</strong>
          <span>${escapeHtml(app.category || "App")} • ${formatNum(app.downloads || 0)} downloads</span>
        </div>
        <div class="mini-app-score">⭐ ${getAverageRating(app)}</div>
      </div>
    `)
    .join("");
}

function renderCategoryFilters(source = allApps) {
  const wrap = $("categoryFilters");
  if (!wrap) return;

  const categories = ["All", ...new Set(source.map((app) => app.category || "Other"))];
  wrap.innerHTML = categories
    .map((category) => {
      const count = category === "All" ? source.length : source.filter((app) => (app.category || "Other") === category).length;
      return `<button class="category-chip ${activeCategory === category ? "active" : ""}" onclick='setCategoryFilter(${toJsString(category)})'>${escapeHtml(category)} <span style="opacity:.75">(${count})</span></button>`;
    })
    .join("");
}

function renderFeaturedGrid(source = allApps) {
  const grid = $("featuredGrid");
  if (!grid) return;

  const featured = getFeaturedApps(source);
  if (!featured.length) {
    grid.innerHTML = '<div class="empty-block">Curated apps will appear here when available.</div>';
    return;
  }

  grid.innerHTML = featured
    .map((app) => `
      <article class="featured-card" onclick='openAppDetail(${toJsString(app.key)})'>
        <div class="featured-top">
          ${getCardIconHtml(app, "featured-icon")}
          <span class="chip">${escapeHtml(app.category || "App")}</span>
        </div>
        <div class="featured-copy">
          <h3>${escapeHtml(app.name)}</h3>
          <p class="featured-desc">${escapeHtml((app.description || "No description available.").slice(0, 120))}${(app.description || "").length > 120 ? "…" : ""}</p>
        </div>
        <div class="featured-meta">
          <span>⭐ ${getAverageRating(app)}</span>
          <span>⬇ ${formatNum(app.downloads || 0)}</span>
        </div>
      </article>
    `)
    .join("");
}

function applyAppFilters(source = allApps) {
  const query = ($("searchInput")?.value || "").trim().toLowerCase();
  return source.filter((app) => {
    const category = app.category || "Other";
    const matchesCategory = activeCategory === "All" || category === activeCategory;
    if (!matchesCategory) return false;
    if (!query) return true;
    const haystack = `${app.name || ""} ${category} ${app.description || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderApps(apps) {
  updateHeroMetrics(allApps);
  renderHeroMiniList(allApps);
  renderCategoryFilters(allApps);
  renderFeaturedGrid(allApps);

  const grid = $("appsGrid");
  const count = $("appCount");
  if (!grid) return;

  if (count) {
    count.textContent = allApps.length
      ? apps.length === allApps.length
        ? `${apps.length} apps available`
        : `Showing ${apps.length} of ${allApps.length} apps`
      : "0 apps available";
  }

  if (!allApps.length) {
    grid.innerHTML = '<div class="empty-state">No apps yet. Admin can add some anytime.</div>';
    return;
  }

  if (!apps.length) {
    grid.innerHTML = '<div class="empty-state">No apps match your search or selected category.</div>';
    return;
  }

  grid.innerHTML = apps
    .map((app) => `
      <article class="app-card" onclick='openAppDetail(${toJsString(app.key)})'>
        <div class="app-card-head">
          ${getCardIconHtml(app)}
          <div>
            <h3 class="app-name">${escapeHtml(app.name)}</h3>
            <div class="app-category">${escapeHtml(app.category || "App")}</div>
          </div>
        </div>
        <div class="app-rating">
          <span>⭐ ${getAverageRating(app)}</span>
          <span>⬇ ${formatNum(app.downloads || 0)}</span>
        </div>
        <p class="app-desc-snippet">${escapeHtml((app.description || "No description available.").slice(0, 110))}${(app.description || "").length > 110 ? "…" : ""}</p>
      </article>
    `)
    .join("");
}

function loadApps() {
  if (allApps.length) renderApps(applyAppFilters());

  if (!firebaseReady) {
    if (!allApps.length) {
      const cached = getCachedApps();
      if (cached.length) {
        allApps = cached;
        renderApps(applyAppFilters());
      }
    }
    return;
  }

  if (appsSubscribed) {
    renderApps(applyAppFilters());
    return;
  }

  const grid = $("appsGrid");
  if (grid && !allApps.length) grid.innerHTML = '<div class="spinner"></div>';

  appsSubscribed = true;
  window._onValue(
    window._ref(window._db, "apps"),
    (snap) => {
      allApps = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          allApps.push({ key: child.key, ...child.val() });
        });
      }
      cacheApps(allApps);
      renderApps(applyAppFilters());
    },
    (error) => {
      appsSubscribed = false;
      console.error("Apps subscription error:", error);
      const cached = getCachedApps();
      if (cached.length) {
        allApps = cached;
        renderApps(applyAppFilters());
        toast("Showing cached apps while live sync is unavailable.", "info", 3600);
      } else {
        if (grid) grid.innerHTML = '<div class="empty-state">Unable to load apps right now.</div>';
      }
    }
  );
}

function filterApps() {
  renderApps(applyAppFilters());
}
window.filterApps = filterApps;

function setCategoryFilter(category) {
  activeCategory = category;
  renderApps(applyAppFilters());
}
window.setCategoryFilter = setCategoryFilter;

async function addAutoReport(appName, userName, rating, comment) {
  if (!firebaseReady) return;
  try {
    const newReportRef = window._push(window._ref(window._db, "reports"));
    await window._set(newReportRef, {
      username: userName,
      email: currentUser ? currentUser.email : "",
      subject: appName,
      message: `${userName} gave ${rating} stars and commented: "${comment || "No comment"}"`,
      timestamp: Date.now(),
      type: "auto_review",
      source: "review_section"
    });
  } catch (e) {
    console.error("Auto report error:", e);
  }
}

function openAppDetail(key) {
  const app = allApps.find((item) => item.key === key);
  if (!app) return;

  currentAppId = key;
  const avgRating = getAverageRating(app);
  const reviews = app.reviews || {};
  const appName = app.name || "App";

  let userExistingReview = null;
  let userExistingRating = 0;
  if (currentUser && currentUser.key) {
    for (const rid in reviews) {
      if (reviews[rid] && reviews[rid].userId === currentUser.key) {
        userExistingReview = reviews[rid];
        userExistingRating = reviews[rid].rating;
        break;
      }
    }
  }

  selectedRatingValue = userExistingRating;

  const reviewItems = Object.keys(reviews)
    .map((rid) => ({ id: rid, ...reviews[rid] }))
    .filter(Boolean)
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  let reviewsHtml = "";
  if (!reviewItems.length) {
    reviewsHtml = '<div class="empty-state" style="min-height:auto">No reviews yet. Be the first to review!</div>';
  } else {
    reviewsHtml = reviewItems
      .map(
        (r) => `
          <div class="review-item">
            <div class="review-user">${escapeHtml(r.username || "Anonymous")}</div>
            <div class="review-rating">${"★".repeat(r.rating || 0)}${"☆".repeat(5 - (r.rating || 0))}</div>
            <div class="review-text">${escapeHtml(r.comment || "")}</div>
            <div class="review-date">${new Date(r.date || Date.now()).toLocaleDateString()}</div>
          </div>
        `
      )
      .join("");
  }

  const screenshots = [app.screenshot1, app.screenshot2, app.screenshot3, app.screenshot4, app.screenshot5].filter(Boolean);
  const screenshotsHtml = screenshots.length
    ? `
      <div class="screenshots-section">
        <div class="screenshots-label">App Screenshots</div>
        <div class="screenshots-scroll">
          ${screenshots
            .map(
              (url, i) => `<img src="${escapeHtml(url)}" class="screenshot-thumb" alt="Screenshot ${i + 1}" onclick='openScreenshot(${toJsString(url)})' onerror="this.style.display='none'">`
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  const starsHtml = [1, 2, 3, 4, 5]
    .map((v) => `<span class="star ${userExistingRating >= v ? "active" : ""}" onclick='setRating(${v})'>★</span>`)
    .join("");

  const content = $("appDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="app-detail-layout">
      <div class="app-detail-hero">
        ${getCardIconHtml(app, "detail-icon-shell")}
        <div>
          <span class="chip">${escapeHtml(app.category || "App")}</span>
          <h2 class="app-detail-name">${escapeHtml(app.name)}</h2>
          <div class="app-detail-subline">Install on your favorite device and keep this listing within reach.</div>
          <div class="app-stats">
            <div class="app-stat"><span class="app-stat-value">⭐ ${avgRating}</span><span class="app-stat-label">Average Rating</span></div>
            <div class="app-stat"><span class="app-stat-value">${formatNum(app.downloads || 0)}</span><span class="app-stat-label">Downloads</span></div>
            <div class="app-stat"><span class="app-stat-value">${reviewItems.length}</span><span class="app-stat-label">Reviews</span></div>
          </div>
        </div>
      </div>

      <div class="app-desc">${escapeHtml(app.description || "No description available.")}</div>

      <div class="detail-actions">
        <button class="btn btn-primary" onclick='downloadApp(${toJsString(app.key)}, ${toJsString(app.link || "")})'>⬇️ Download Now</button>
        <button class="btn btn-ghost" onclick="openReport()">Need help?</button>
      </div>
      <div class="detail-note">${currentUser ? "You can rate and download instantly with your logged-in account." : "Login is required before downloading or reviewing apps."}</div>

      ${screenshotsHtml}

      <div class="rating-section">
        <div class="section-block-title">Rate this App</div>
        <div class="stars">${starsHtml}</div>
        <div class="input-group" style="margin-top:12px;">
          <label for="reviewText">Write a Review</label>
          <textarea id="reviewText" rows="3" placeholder="Share your experience...">${userExistingReview ? escapeHtml(userExistingReview.comment || "") : ""}</textarea>
        </div>
        <button class="btn btn-outline btn-sm" onclick='submitReview(${toJsString(appName)})'>📝 Submit Review</button>

        <div style="margin-top:20px;">
          <div class="section-block-title">User Reviews</div>
          <div class="reviews-list">${reviewsHtml}</div>
        </div>
      </div>
    </div>
  `;

  $("appDetailOverlay")?.classList.remove("hidden");
}
window.openAppDetail = openAppDetail;

function openScreenshot(url) {
  const lb = document.createElement("div");
  lb.className = "screenshot-lightbox";
  lb.innerHTML = `<button class="screenshot-lightbox-close" onclick="this.parentElement.remove()">✕</button><img src="${escapeHtml(url)}" alt="Screenshot">`;
  lb.onclick = (e) => {
    if (e.target === lb) lb.remove();
  };
  document.body.appendChild(lb);
}
window.openScreenshot = openScreenshot;

function setRating(rating) {
  selectedRatingValue = rating;
  document.querySelectorAll(".star").forEach((star, i) => {
    star.classList.toggle("active", i < rating);
  });
  toast(`Selected ${rating} star rating!`, "success");
}
window.setRating = setRating;

async function submitReview(appName) {
  if (!currentUser) {
    toast("Please login to review!", "error");
    return;
  }
  if (!selectedRatingValue) {
    toast("Please select a star rating first!", "error");
    return;
  }

  const comment = $("reviewText")?.value.trim() || "";

  try {
    const appRef = window._ref(window._db, `apps/${currentAppId}`);
    const appSnap = await window._get(appRef);
    const appData = appSnap.val();
    const existingReviews = appData.reviews || {};
    let existingReviewId = null;

    for (const rid in existingReviews) {
      if (existingReviews[rid] && existingReviews[rid].userId === currentUser.key) {
        existingReviewId = rid;
        break;
      }
    }

    if (existingReviewId) {
      await window._update(window._ref(window._db, `apps/${currentAppId}/reviews/${existingReviewId}`), {
        rating: selectedRatingValue,
        comment,
        date: Date.now(),
        source: "review"
      });
      toast("Your review has been updated! ✅", "success");
    } else {
      await window._set(window._push(window._ref(window._db, `apps/${currentAppId}/reviews`)), {
        userId: currentUser.key,
        username: currentUser.name,
        rating: selectedRatingValue,
        comment,
        date: Date.now(),
        source: "review"
      });
      toast("Review submitted! Thanks! 🎉", "success");
    }

    await addAutoReport(appName, currentUser.name, selectedRatingValue, comment);
    if ($("reviewText")) $("reviewText").value = "";
    openAppDetail(currentAppId);
    loadApps();
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}
window.submitReview = submitReview;

async function downloadApp(key, link) {
  if (!currentUser) {
    closeModal("appDetailOverlay");
    showPage("authPage");
    toast("Please login to download!", "error");
    return;
  }

  try {
    const appRef = window._ref(window._db, `apps/${key}`);
    await window._runTransaction(appRef, (currentData) => {
      if (currentData) currentData.downloads = (currentData.downloads || 0) + 1;
      return currentData;
    });
    toast("Download started! 🚀", "success");
    if (link && link.startsWith("http")) window.open(link, "_blank");
  } catch {
    toast("Error updating downloads", "error");
  }
}
window.downloadApp = downloadApp;

function closeModal(id) {
  $(id)?.classList.add("hidden");
}
window.closeModal = closeModal;

function closeAppDetail(e) {
  if (e && e.target === $("appDetailOverlay")) closeModal("appDetailOverlay");
}
window.closeAppDetail = closeAppDetail;

function openReport() {
  $("reportOverlay")?.classList.remove("hidden");
}
window.openReport = openReport;

function closeReportM(e) {
  if (e && e.target === $("reportOverlay")) closeModal("reportOverlay");
}
window.closeReportM = closeReportM;

async function sendReport() {
  const sub = $("rSubject")?.value.trim();
  const msg = $("rMsg")?.value.trim();
  if (!sub || !msg) {
    toast("Please fill all fields!", "error");
    return;
  }
  if (!firebaseReady) {
    toast("Connecting...", "info");
    return;
  }

  try {
    const newRef = window._push(window._ref(window._db, "reports"));
    await window._set(newRef, {
      username: currentUser ? currentUser.name : "Anonymous",
      email: currentUser ? currentUser.email || "" : "",
      subject: sub,
      message: msg,
      timestamp: Date.now(),
      type: "report_us",
      source: "report_us"
    });
    toast("Report submitted! 🙏", "success");
    if ($("rSubject")) $("rSubject").value = "";
    if ($("rMsg")) $("rMsg").value = "";
    closeModal("reportOverlay");
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}
window.sendReport = sendReport;

function openAbout() {
  $("aboutOverlay")?.classList.remove("hidden");
}
window.openAbout = openAbout;

function closeAboutM(e) {
  if (e && e.target === $("aboutOverlay")) closeModal("aboutOverlay");
}
window.closeAboutM = closeAboutM;

function openApkDownload() {
  closeMenu();
  if (apkDownloadLink && apkDownloadLink.startsWith("http")) {
    window.open(apkDownloadLink, "_blank");
  } else {
    toast("APK link not set by admin yet.", "error");
  }
}
window.openApkDownload = openApkDownload;

function setupGlobalEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    sessionStorage.removeItem(CACHE_KEYS.installDismissed);
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    sessionStorage.setItem(CACHE_KEYS.installDismissed, "1");
    updateInstallUI();
    toast("SamWeb Store installed successfully!", "success");
  });

  window.addEventListener("online", () => {
    updateConnectionState();
    loadWebsiteSettings();
    loadApps();
    recordVisit();
    toast("Back online. Syncing live data...", "success");
  });

  window.addEventListener("offline", () => {
    updateConnectionState();
    toast("You are offline. Cached content is still available.", "info", 3600);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenu();
    closeModal("appDetailOverlay");
    closeModal("reportOverlay");
    closeModal("aboutOverlay");
    document.querySelectorAll(".screenshot-lightbox").forEach((el) => el.remove());
  });
}

function initShell() {
  createParticles();
  hydrateFromCache();
  loadSession();
  updateConnectionState();
  updateInstallUI();
  registerServiceWorker();
  setupGlobalEvents();
}

function onFirebaseReady() {
  firebaseReady = true;
  console.log("Firebase connected ✅");
  loadApps();
  loadWebsiteSettings();
  recordVisit();
}

window.addEventListener("firebaseReady", onFirebaseReady);

initShell();
window.dispatchEvent(new Event("firebaseReady"));
