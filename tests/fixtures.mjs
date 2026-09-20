// Shared deterministic fixtures for tests (no real user data).
export const NOW = Date.now();
const DAY = 86400000;

// Mirrors the real Firebase `apps` shape (object keyed by push id),
// including one legacy record WITHOUT version fields and a duplicate name.
export const FIXTURE_APPS = {
  "-Test0001keyAAA": {
    name: "Sam Calculator",
    category: "Social",
    description: "Sam Calculator is a modern, smooth, and fully manual calculator app with Material UI design.",
    downloads: 11,
    icon: "🧮",
    imageUrl: "https://cdn.example.test/calc.png",
    link: "https://example.test/downloads/sam-calculator.apk",
    rating: 0,
    versionName: "2.5.1",
    versionCode: 25,
    packageName: "com.samva.calculator",
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 2 * DAY
  },
  "-Test0002keyBBB": {
    name: "Samva Online Tic Tac Toe",
    category: "Games",
    description: "Real-time multiplayer online tic tac toe with 6-digit UID challenges and a global leaderboard.",
    downloads: 28,
    icon: "🎮",
    imageUrl: "https://cdn.example.test/ttt.jpg",
    link: "https://example.test/downloads/ttt.apk",
    rating: 0,
    screenshot1: "https://cdn.example.test/s1.jpg",
    screenshot2: "https://cdn.example.test/s2.jpg",
    reviews: {
      r1: { userId: "u1", username: "Rahim", rating: 5, comment: "Great game, no lag!", date: NOW - 5 * DAY, source: "review" },
      r2: { userId: "u2", username: "Sadia", rating: 4, comment: "Fun with friends.", date: NOW - 3 * DAY, source: "review" }
    }
  },
  "-Test0003keyCCC": {
    // Legacy record: no version fields, no timestamps
    name: "CloudKeep Notebook",
    category: "Tools",
    description: "A clean, simple note-taking app that syncs to the cloud.",
    downloads: 7,
    icon: "📝",
    imageUrl: "https://cdn.example.test/cloud.png",
    link: "https://example.test/downloads/cloudkeep.apk",
    rating: 0
  },
  "-Test0004keyDDD": {
    // Duplicate name → slug collision handling
    name: "Sam Calculator",
    category: "Tools",
    description: "Another calculator listing with the same name (collision test).",
    downloads: 2,
    icon: "🧮",
    link: null,
    rating: 0
  },
  "-Test0005keyEEE": {
    name: "No Link App",
    category: "Entertainment",
    description: "Listing without any download link.",
    downloads: 0,
    icon: "🎬",
    rating: 0
  }
};

export function fixtureAppsArray() {
  return Object.entries(FIXTURE_APPS).map(([key, value]) => ({ key, ...value }));
}

// Mirrors the real Firebase `users` shape with acquisition data as saved at signup,
// plus one legacy user without acquisition.
export const FIXTURE_USERS = {
  "-User0001aaaa": {
    name: "Ayesha Khatun",
    email: "ayesha@example.test",
    number: "+8801700000001",
    password: "secret1",
    gender: "Female",
    createdAt: NOW - 2 * DAY,
    signupSource: "Facebook",
    signupCampaign: "app_launch",
    acquisition: {
      firstTouch: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: NOW - 3 * DAY, lastSeenAt: "" },
      latestTouch: { source: "Facebook", sourceType: "Social", medium: "social", campaign: "app_launch", content: "hero", term: "", landingPage: "/app/sam-calculator", firstSeenAt: "", lastSeenAt: NOW - 2 * DAY },
      signup: { source: "Facebook", sourceType: "Social", medium: "social", campaign: "app_launch", content: "hero", term: "", landingPage: "/app/sam-calculator", signupAt: NOW - 2 * DAY },
      userSelectedSource: "Friend / Someone shared it",
      attributionVersion: 1
    }
  },
  "-User0002bbbb": {
    name: "Rakib Hasan",
    email: "rakib@example.test",
    number: "+8801700000002",
    password: "secret2",
    gender: "Male",
    createdAt: NOW - 20 * DAY,
    signupSource: "Google",
    signupCampaign: "",
    acquisition: {
      firstTouch: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: NOW - 20 * DAY, lastSeenAt: "" },
      latestTouch: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", firstSeenAt: "", lastSeenAt: NOW - 20 * DAY },
      signup: { source: "Google", sourceType: "Search", medium: "organic", campaign: "", content: "", term: "", landingPage: "/", signupAt: NOW - 20 * DAY },
      userSelectedSource: "Google",
      attributionVersion: 1
    }
  },
  "-User0003cccc": {
    // Legacy user (registered before attribution existed)
    name: "Legacy User",
    email: "legacy@example.test",
    number: "+8801700000003",
    password: "secret3",
    gender: "Other",
    createdAt: NOW - 60 * DAY
  },
  "-User0004dddd": {
    name: "Direct Dana",
    email: "dana@example.test",
    number: "+8801700000004",
    password: "secret4",
    gender: "Female",
    createdAt: NOW - 1 * DAY,
    signupSource: "TikTok",
    signupCampaign: "eid2026",
    acquisition: {
      firstTouch: { source: "TikTok", sourceType: "Social", medium: "social", campaign: "eid2026", content: "", term: "", landingPage: "/game/samva-online-tic-tac-toe", firstSeenAt: NOW - 1 * DAY, lastSeenAt: "" },
      latestTouch: { source: "TikTok", sourceType: "Social", medium: "social", campaign: "eid2026", content: "", term: "", landingPage: "/game/samva-online-tic-tac-toe", firstSeenAt: "", lastSeenAt: NOW - 1 * DAY },
      signup: { source: "TikTok", sourceType: "Social", medium: "social", campaign: "eid2026", content: "", term: "", landingPage: "/game/samva-online-tic-tac-toe", signupAt: NOW - 1 * DAY },
      userSelectedSource: "TikTok",
      attributionVersion: 1
    }
  }
};

export const FIXTURE_ADMINS = {
  "-Admin001": { username: "testadmin", email: "admin@example.test", password: "testpass123" }
};
