import { requireAdmin } from "./_shared/auth.mjs";
import { json } from "./_shared/json.mjs";
import { siteAnalyticsStore } from "./_shared/storage.mjs";

function uniqueCount(map = {}) {
  return Object.keys(map || {}).length;
}

function addCount(target, key, amount) {
  const cleanKey = key || "unknown";
  target[cleanKey] = (target[cleanKey] || 0) + amount;
}

function topEntries(map = {}, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export default async (req) => {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const store = siteAnalyticsStore();
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 90);
  const today = new Date();
  const wantedDays = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  });

  const rows = (await Promise.all(wantedDays.map(async (day) => {
    const data = await store.get(`days/${day}.json`, { type: "json" });
    return data ? { ...data, day } : { day, pageviews: 0, visitors: {}, pages: {}, referrers: {}, browsers: {} };
  }))).sort((a, b) => a.day.localeCompare(b.day));

  const totals = {
    pageviews: 0,
    visitors: 0
  };
  const pages = {};
  const referrers = {};
  const browsers = {};

  for (const row of rows) {
    totals.pageviews += Number(row.pageviews || 0);
    totals.visitors += uniqueCount(row.visitors);

    for (const page of Object.values(row.pages || {})) {
      const existing = pages[page.path] || { path: page.path, title: page.title || page.path, pageviews: 0, visitors: 0 };
      existing.pageviews += Number(page.pageviews || 0);
      existing.visitors += uniqueCount(page.visitors);
      pages[page.path] = existing;
    }

    for (const [name, count] of Object.entries(row.referrers || {})) addCount(referrers, name, Number(count || 0));
    for (const [name, count] of Object.entries(row.browsers || {})) addCount(browsers, name, Number(count || 0));
  }

  return json({
    ok: true,
    days,
    totals,
    daily: rows.map((row) => ({
      day: row.day,
      pageviews: Number(row.pageviews || 0),
      visitors: uniqueCount(row.visitors)
    })),
    pages: Object.values(pages).sort((a, b) => b.pageviews - a.pageviews).slice(0, 20),
    referrers: topEntries(referrers),
    browsers: topEntries(browsers)
  });
};

export const config = {
  path: "/api/admin/analytics"
};
