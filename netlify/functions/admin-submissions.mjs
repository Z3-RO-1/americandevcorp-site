import { requireAdmin } from "./_shared/auth.mjs";
import { json } from "./_shared/json.mjs";
import { applicationStore, listStoreJSON, requestStore } from "./_shared/storage.mjs";

export default async (req) => {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "requests";
  const store = type === "applications" ? applicationStore() : requestStore();
  const items = await listStoreJSON(store);

  return json({ items });
};

export const config = {
  path: "/api/admin/submissions"
};
