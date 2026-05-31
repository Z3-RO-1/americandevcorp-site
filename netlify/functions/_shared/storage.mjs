import { getStore } from "@netlify/blobs";

export const requestStore = () => getStore({ name: "ios-submission-requests", consistency: "strong" });
export const applicationStore = () => getStore({ name: "ios-application-submissions", consistency: "strong" });
export const accessCodeStore = () => getStore({ name: "ios-submission-access-codes", consistency: "strong" });

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
