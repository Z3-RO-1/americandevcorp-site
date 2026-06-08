import { adminMarketDirectoryEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { makeId, marketDirectoryStore } from "./_shared/storage.mjs";

const allowedEndpoints = new Set([
  "consumer-signup",
  "message",
  "storefront-upvote",
  "storefront-review",
  "support-request",
  "host-access-request",
  "sponsorship-request"
]);

function endpointFromRequest(req) {
  const pathname = new URL(req.url).pathname;
  return pathname.split("/").filter(Boolean).at(-1) || "";
}

function titleFor(endpoint, payload) {
  switch (endpoint) {
    case "consumer-signup":
      return payload.email || "New consumer signup";
    case "message":
      return payload.storefront_name || "Storefront message";
    case "storefront-upvote":
      return payload.storefront_name || "Storefront upvote";
    case "storefront-review":
      return payload.storefront_name || "Storefront review";
    case "support-request":
      return payload.topic || payload.email || "Support request";
    case "sponsorship-request":
      return payload.business_name || payload.email || "Sponsorship request";
    case "host-access-request":
      return payload.business_name || payload.email || "Hosting access request";
    default:
      return endpoint;
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const endpoint = endpointFromRequest(req);
  if (!allowedEndpoints.has(endpoint)) {
    return json({ error: "Unknown Market Directory endpoint" }, { status: 404 });
  }

  const payload = await readJSON(req);
  const now = new Date().toISOString();
  const record = {
    id: makeId(`market_${endpoint.replaceAll("-", "_")}`),
    type: "market-directory",
    endpoint,
    title: titleFor(endpoint, payload),
    status: "new",
    createdAt: now,
    payload
  };

  await marketDirectoryStore().setJSON(record.id, record);

  if (["support-request", "host-access-request", "sponsorship-request", "storefront-review"].includes(endpoint)) {
    await sendEmail(adminMarketDirectoryEmail(record));
  }

  return json({ ok: true, id: record.id });
};

export const config = {
  path: "/api/market-directory/:endpoint"
};
