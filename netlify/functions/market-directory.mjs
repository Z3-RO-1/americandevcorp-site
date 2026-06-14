import { adminMarketDirectoryEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { listStoreJSON, makeId, marketDirectoryStore } from "./_shared/storage.mjs";

const allowedEndpoints = new Set([
  "consumer-signup",
  "message",
  "storefront-upvote",
  "storefront-review",
  "store-host-signup",
  "store-hosts",
  "support-request",
  "host-access-request",
  "sponsorship-request",
  "storefront-status",
  "billing-receipt"
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
    case "store-host-signup":
      return payload.business_name || payload.email || "Store Host signup";
    case "support-request":
      return payload.topic || payload.email || "Support request";
    case "sponsorship-request":
      return payload.business_name || payload.email || "Sponsorship request";
    case "host-access-request":
      return payload.business_name || payload.email || "Hosting access request";
    case "billing-receipt":
      return payload.business_name || payload.product_id || "Billing receipt";
    case "storefront-status":
      return payload.business_name || payload.email || "Storefront status";
    default:
      return endpoint;
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value) {
  return value === true || value === "true";
}

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function storefrontKey(payload) {
  const email = text(payload.email).toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return `business:${text(payload.business_name).toLowerCase()}`;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function hostSeedFromRecord(record) {
  const payload = record.payload || {};
  const businessName = text(payload.business_name);
  const email = text(payload.email).toLowerCase();

  if (!businessName || !email) {
    return null;
  }

  return {
    key: storefrontKey(payload),
    business_name: businessName,
    owner_name: text(payload.owner_name) || text(payload.full_name) || "Store Host",
    email,
    status: text(payload.status) || "Active",
    category_name: text(payload.category_name) || text(payload.category_type) || "Local Services",
    city: text(payload.city),
    state: text(payload.state).toUpperCase(),
    business_summary: text(payload.business_summary),
    requires_age_verification: bool(payload.requires_age_verification),
    minimum_age: int(payload.minimum_age, 18),
    is_live_subscription_active: bool(payload.is_live_subscription_active),
    setup_package_purchased: bool(payload.setup_package_purchased),
    edit_request_credits: int(payload.edit_request_credits, 0),
    beta_service_mode: text(payload.beta_service_mode) || "No Trial",
    beta_trial_ends_at: text(payload.beta_trial_ends_at),
    is_sponsored_by_market_directory: bool(payload.is_sponsored_by_market_directory),
    last_purchase_note: text(payload.last_purchase_note),
    created_at: record.createdAt
  };
}

function applyStatus(host, record) {
  const payload = record.payload || {};
  return {
    ...host,
    status: text(payload.status) || host.status,
    category_name: text(payload.category_name) || host.category_name,
    city: text(payload.city) || host.city,
    state: text(payload.state) || host.state,
    business_summary: text(payload.business_summary) || host.business_summary,
    requires_age_verification: hasOwn(payload, "requires_age_verification") ? bool(payload.requires_age_verification) : host.requires_age_verification,
    minimum_age: hasOwn(payload, "minimum_age") ? int(payload.minimum_age, host.minimum_age) : host.minimum_age,
    is_live_subscription_active: hasOwn(payload, "is_live_subscription_active") ? bool(payload.is_live_subscription_active) : host.is_live_subscription_active,
    setup_package_purchased: hasOwn(payload, "setup_package_purchased") ? bool(payload.setup_package_purchased) : host.setup_package_purchased,
    edit_request_credits: hasOwn(payload, "edit_request_credits") ? int(payload.edit_request_credits, host.edit_request_credits) : host.edit_request_credits,
    beta_service_mode: text(payload.beta_service_mode) || host.beta_service_mode,
    beta_trial_ends_at: hasOwn(payload, "beta_trial_ends_at") ? text(payload.beta_trial_ends_at) : host.beta_trial_ends_at,
    is_sponsored_by_market_directory: hasOwn(payload, "is_sponsored_by_market_directory") ? bool(payload.is_sponsored_by_market_directory) : host.is_sponsored_by_market_directory,
    last_purchase_note: text(payload.last_purchase_note) || host.last_purchase_note,
    updated_at: record.createdAt
  };
}

async function listStoreHosts() {
  const records = await listStoreJSON(marketDirectoryStore());
  const hosts = new Map();

  for (const record of records.slice().reverse()) {
    if (!["store-host-signup", "host-access-request"].includes(record.endpoint)) {
      continue;
    }

    const host = hostSeedFromRecord(record);
    if (host && !hosts.has(host.key)) {
      hosts.set(host.key, host);
    }
  }

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "storefront-status") {
      continue;
    }

    const key = storefrontKey(record.payload || {});
    const existing = hosts.get(key);
    if (existing) {
      hosts.set(key, applyStatus(existing, record));
    }
  }

  return Array.from(hosts.values())
    .filter((host) => host.status !== "Scheduled for Deletion")
    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

export default async (req) => {
  const endpoint = endpointFromRequest(req);

  if (req.method === "GET") {
    if (endpoint !== "store-hosts") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    return json({ ok: true, store_hosts: await listStoreHosts() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

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

  if (["support-request", "host-access-request", "store-host-signup", "storefront-status", "sponsorship-request", "storefront-review", "billing-receipt"].includes(endpoint)) {
    await sendEmail(adminMarketDirectoryEmail(record));
  }

  return json({ ok: true, id: record.id });
};

export const config = {
  path: "/api/market-directory/:endpoint"
};
