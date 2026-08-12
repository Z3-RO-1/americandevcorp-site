import { listStoreJSON, marketDirectoryStore } from "./storage.mjs";

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function bool(value) {
  return value === true || value === "true";
}

export function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

export function storefrontKey(payload) {
  const email = text(payload.email).toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return `business:${text(payload.business_name).toLowerCase()}`;
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

// Every store host, folded from signup/access-request + status-update events into current state.
// Single source of truth — market-directory.mjs and the sign-in endpoints both import this
// rather than each re-deriving it, so "who is a real store host" can never drift between them.
export async function listStoreHosts() {
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

export async function resolveStoreHostByEmail(email) {
  const normalized = text(email).toLowerCase();
  if (!normalized) {
    return null;
  }

  const hosts = await listStoreHosts();
  return hosts.find((host) => host.email === normalized) || null;
}

export async function resolveStoreHostByKey(key) {
  if (!key) {
    return null;
  }

  const hosts = await listStoreHosts();
  return hosts.find((host) => host.key === key) || null;
}

// Active consumer accounts, folded from consumer-signup records with any later
// consumer-deletion tombstone applied. The record's blob `key` is included so callers
// (e.g. account deletion) can address the exact underlying blob without re-scanning.
//
// A later consumer-signup for the same email is treated as a profile-update event, not a
// fresh account — only first_name/last_name/address may change that way. email and birth_date
// stay pinned to whatever the original signup recorded, since birth_date backs age verification
// and must not be gameable by "re-submitting" the signup form with a different date.
export async function listConsumers() {
  const records = await listStoreJSON(marketDirectoryStore());
  const consumers = new Map();
  const deletedAt = new Map();

  for (const record of records) {
    if (record.endpoint !== "consumer-deletion") {
      continue;
    }
    const email = text((record.payload || {}).email).toLowerCase();
    if (email && !deletedAt.has(email)) {
      deletedAt.set(email, record.createdAt);
    }
  }

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "consumer-signup") {
      continue;
    }

    const email = text((record.payload || {}).email).toLowerCase();
    if (!email) {
      continue;
    }

    const existing = consumers.get(email);
    consumers.set(email, existing
      ? {
          ...existing,
          first_name: text(record.payload.first_name) || existing.first_name,
          last_name: text(record.payload.last_name) || existing.last_name,
          address: text(record.payload.address) || existing.address,
          updated_at: record.createdAt
        }
      : { ...record.payload, email, recordKey: record.key, created_at: record.createdAt });
  }

  return Array.from(consumers.values()).filter((consumer) => {
    const deletion = deletedAt.get(consumer.email);
    return !deletion || deletion < (consumer.updated_at || consumer.created_at);
  });
}

export async function resolveConsumerByEmail(email) {
  const normalized = text(email).toLowerCase();
  if (!normalized) {
    return null;
  }

  const consumers = await listConsumers();
  return consumers.find((consumer) => consumer.email === normalized) || null;
}

// Single place birth-date input is validated, shared by the atomic sign-up-during-verify path
// and the direct consumer-signup endpoint, so the two can never accept different date shapes.
export function parseBirthDate({ birth_month, birth_day, birth_year } = {}) {
  const month = text(birth_month);
  const day = text(birth_day);
  const year = text(birth_year);

  if (!/^\d{2}$/.test(month) || !/^\d{2}$/.test(day) || !/^\d{4}$/.test(year)) {
    return { valid: false };
  }

  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const currentYear = new Date().getUTCFullYear();
  const valid = !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(year)
    && date.getTime() < Date.now()
    && Number(year) > currentYear - 120;

  return valid ? { valid: true, isoDate: `${year}-${month}-${day}` } : { valid: false };
}

export function ageFromISODate(isoDate) {
  if (!isoDate) {
    return null;
  }

  const birth = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const hasHadBirthdayThisYear = now.getUTCMonth() > birth.getUTCMonth()
    || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age;
}
