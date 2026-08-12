import { getStore } from "@netlify/blobs";

export const requestStore = () => getStore({ name: "ios-submission-requests", consistency: "strong" });
export const applicationStore = () => getStore({ name: "ios-application-submissions", consistency: "strong" });
export const accessCodeStore = () => getStore({ name: "ios-submission-access-codes", consistency: "strong" });
export const signInCodeStore = () => getStore({ name: "site-sign-in-codes", consistency: "strong" });
export const marketDirectoryStore = () => getStore({ name: "market-directory-beta-intake", consistency: "strong" });
export const marketDirectoryMediaStore = () => getStore({ name: "market-directory-media", consistency: "strong" });
export const siteAnalyticsStore = () => getStore({ name: "adc-site-analytics", consistency: "strong" });

export function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}

export async function listStoreJSON(store) {
  const { blobs } = await store.list();
  const rows = await Promise.all(
    blobs.map(async (blob) => {
      const data = await store.get(blob.key, { type: "json" });
      return data ? { key: blob.key, ...data } : null;
    })
  );

  return rows
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
