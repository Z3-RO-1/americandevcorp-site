import { siteAnalyticsStore } from "./_shared/storage.mjs";
import { json, readJSON } from "./_shared/json.mjs";

const encoder = new TextEncoder();

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safePath(value) {
  const path = String(value || "/").trim();
  if (!path.startsWith("/")) return "/";
  return path.slice(0, 180);
}

function safeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function safeReferrer(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    return "";
  }
}

function userAgentFamily(value) {
  const agent = String(value || "").toLowerCase();
  if (agent.includes("edg/")) return "Edge";
  if (agent.includes("chrome/") || agent.includes("crios/")) return "Chrome";
  if (agent.includes("safari/") && !agent.includes("chrome/")) return "Safari";
  if (agent.includes("firefox/") || agent.includes("fxios/")) return "Firefox";
  return "Other";
}

function clientIp(req, context) {
  return context.ip
    || req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "";
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function emptyDay(day) {
  return {
    day,
    pageviews: 0,
    visitors: {},
    pages: {},
    referrers: {},
    browsers: {},
    updatedAt: new Date().toISOString()
  };
}

function bump(map, key, amount = 1) {
  const cleanKey = key || "unknown";
  map[cleanKey] = (map[cleanKey] || 0) + amount;
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await readJSON(req);
  const day = isoDay();
  const path = safePath(body.path);

  if (path.startsWith("/admin") || path.startsWith("/api")) {
    return json({ ok: true, skipped: true });
  }

  const store = siteAnalyticsStore();
  const key = `days/${day}.json`;
  const current = await store.get(key, { type: "json" }) || emptyDay(day);
  const visitorId = await sha256([
    day,
    clientIp(req, context),
    req.headers.get("user-agent") || ""
  ].join("|"));

  current.pageviews += 1;
  current.visitors[visitorId] = 1;
  current.updatedAt = new Date().toISOString();

  const page = current.pages[path] || {
    path,
    title: safeTitle(body.title),
    pageviews: 0,
    visitors: {}
  };
  page.title = page.title || safeTitle(body.title);
  page.pageviews += 1;
  page.visitors[visitorId] = 1;
  current.pages[path] = page;

  bump(current.referrers, safeReferrer(body.referrer) || "direct");
  bump(current.browsers, userAgentFamily(req.headers.get("user-agent")));

  await store.setJSON(key, current);
  return json({ ok: true });
};

export const config = {
  path: "/api/analytics/track"
};
