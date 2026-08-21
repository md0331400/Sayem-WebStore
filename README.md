# SamWeb Store 🛒

Apps & Games ডাউনলোড প্ল্যাটফর্ম — Firebase Realtime Database + PWA (Progressive Web App) দিয়ে বানানো সম্পূর্ণ ওয়েবসাইট।

## ✨ Features

- 🏠 Premium landing page (hero, featured apps, categories, stats, footer)
- 🔍 Live search + category filter
- 🔐 Login / Sign Up (Firebase Realtime Database)
- ⭐ App rating ও user review system
- ⬇️ Download counter (login করা লাগবে)
- 📱 PWA support — Install App button, offline mode, cached data
- 📣 Report Us ফর্ম (report সরাসরি Firebase-এ যায়)
- 👤 Visitor tracking (device token ভিত্তিক, duplicate হয় না)

## 📁 Project Structure

```
├── index.html        → Main website (নতুন পূর্ণাঙ্গ landing page)
├── admin/index.html  → Admin Panel (⚙️ /admin URL-এ) — ads, apps, users, visitors, stats
├── style.css         → পুরো design/theme
├── app.js            → সব logic (Firebase, auth, apps, ads engine, PWA, tracking)
├── manifest.json     → PWA manifest
├── service-worker.js → Offline cache
├── robots.txt        → Search engine
├── sitemap.xml       → Sitemap
└── icons/            → Logo, favicon, PWA icons
```

## 🖥️ লোকালি চালানো

যেকোনো একটা উপায়ে:

```bash
# Python দিয়ে (যদি python থাকে)
python3 -m http.server 8000

# VS Code এ index.html খুলে Right Click → "Open with Live Server"
```

তারপর browser এ যাও: `http://localhost:8000`

> ⚠️ Note: Firebase API key browser থেকে ব্যবহার করা হয়। Database-এর
> `users` node-এ password plain text-এ যাচ্ছে। Production-এ যাওয়ার আগে
> Firebase Authentication ব্যবহার করাটা বেশি secure হবে।

## 🌍 Live Website বানানো (Deploy)

### Option 1: GitHub Pages (Free, সবচেয়ে সহজ)

1. Code টা তোমার GitHub repo-তে push করো
2. Repo → **Settings** → **Pages**
3. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)`
4. Save — কয়েক মিনিটে সাইট live হবে:
   `https://<your-username>.github.io/Sayem-WebStore/`

### Option 2: Firebase Hosting (Free)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting        # public directory: এই ফোল্ডারটাই
firebase deploy
```

### Option 3: Netlify (Free, drag & drop)

1. [netlify.com](https://app.netlify.com/drop) এ যাও
2. পুরো ফোল্ডারটা drag & drop করো
3. Live link সাথে সাথে পেয়ে যাবে

## ⚙️ Admin Panel

Admin Panel এখন এই repo-তেই আছে — deploy করার পর **`/admin`** URL-এ পাওয়া যাবে
(যেমন `https://your-domain.com/admin`)। আগের মতোই Firebase `admins` node-এর
username/password দিয়ে login হয়।

Admin Panel থেকে করা যায়:

- 📊 **Dashboard** — users, apps, reports, visitors, downloads, reviews, **total & আজকের ad impressions**
- 🎯 **Ads Manager** — ad add/remove/edit, on/off switch, প্রতিটা ad-এর code দেখা/পরিবর্তন,
  কোন ad কোথায় বসবে (placements), প্রতি slot-এ max কতগুলো ad, per-ad & per-slot impressions
- ➕ Apps add/edit/delete, 👥 Users, 📊 Reports, 👥 Visitor tracking details
- ⚙️ Settings — admin credentials, website name, logo

> 📝 পুরনো **APK download system বাদ দেওয়া হয়েছে** — app টা এখন সম্পূর্ণ PWA,
> userরা browser থেকেই "Install App" করতে পারে।

### Ads data model (Firebase)

```
ads/<pushKey>              → { name, code, placements[], enabled, createdAt, updatedAt }
settings/adsInitialized    → true (Ads Manager প্রথমবার খুললেই set হয়)
settings/adsMaxPerSlot     → প্রতি placement-এ সর্বোচ্চ কতগুলো ad (1–3)
adStats/total              → সর্বমোট impressions
adStats/perAd/<adKey>      → per-ad impressions
adStats/perSlot/<slot>     → per-placement impressions
adStats/daily/<YYYYMMDD>   → দিনভিত্তিক impressions
```

Placements: `home_top`, `home_mid`, `home_bottom`, `games_top`, `apps_top`,
`detail_bottom`, `floating` (social bar / popunder টাইপ)।

---

Built with ❤️ in Bangladesh 🇧🇩
