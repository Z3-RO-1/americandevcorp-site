import { adminPasswordMatches, bearerToken, createRoleToken, readToken, requireAdmin } from "./_shared/auth.mjs";
import { adminMarketDirectoryEmail, marketDirectoryProductDecisionEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { listStoreJSON, makeId, marketDirectoryMediaStore, marketDirectoryStore } from "./_shared/storage.mjs";

const allowedEndpoints = new Set([
  "consumer-signup",
  "message",
  "storefront-open",
  "storefront-upvote",
  "storefront-review",
  "storefront-order",
  "storefront-order-update",
  "merchant-contact",
  "store-host-signup",
  "store-host-session",
  "store-host-code-request",
  "store-host-code-verify",
  "store-host-agreement-accept",
  "admin-session",
  "store-hosts",
  "storefront-analytics",
  "storefront-product",
  "storefront-products",
  "storefront-products-owned",
  "storefront-products-review",
  "product-media",
  "support-request",
  "host-access-request",
  "sponsorship-request",
  "storefront-status",
  "billing-receipt"
]);

const adminWriteEndpoints = new Set([
  "storefront-status"
]);

const liveStorefrontProductID = "com.americandevcorp.marketdirectory.live_storefront.monthly";
const setupPackageProductID = "com.americandevcorp.marketdirectory.store_build";
const editRequestProductID = "com.americandevcorp.marketdirectory.edit_request_credit";
const ownerManagedTrialMode = "90-Day Owner-Managed Trial";
const knownBillingProductIDs = new Set([
  liveStorefrontProductID,
  setupPackageProductID,
  editRequestProductID
]);
const allowedProductImageContentTypes = new Set([
  "image/jpeg",
  "image/png"
]);
const maxProductImageBytes = 5 * 1024 * 1024;

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
    case "storefront-open":
      return payload.storefront_name || "Storefront open";
    case "storefront-upvote":
      return payload.storefront_name || "Storefront upvote";
    case "storefront-review":
      return payload.storefront_name || "Storefront review";
    case "storefront-order":
      return payload.storefront_name || "Storefront order request";
    case "storefront-order-update":
      return payload.storefront_name || "Storefront order update";
    case "merchant-contact":
      return payload.customer_name || payload.customer_email || payload.storefront_name || "Merchant contact";
    case "storefront-product":
      return payload.product_title || payload.storefront_name || "Storefront product";
    case "store-host-signup":
      return payload.business_name || payload.email || "Store Host signup";
    case "store-host-session":
      return payload.email || "Store Host session";
    case "store-host-code-request":
      return payload.email || "Merchant code request";
    case "store-host-code-verify":
      return payload.email || "Merchant code verify";
    case "store-host-agreement-accept":
      return payload.email || "Merchant agreement";
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

async function sendOperationalEmail(message) {
  try {
    const result = await sendEmail(message);
    if (!result?.sent) {
      console.log("Market Directory email skipped.", {
        to: message.to,
        subject: message.subject,
        reason: result?.reason || "unknown"
      });
    }
  } catch (error) {
    console.log("Market Directory email failed after record persistence.", {
      to: message.to,
      subject: message.subject,
      error: error?.message || String(error)
    });
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).slice(0, 3)
    : [];
}

function bool(value) {
  return value === true || value === "true";
}

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mediaURL(req, assetKey) {
  if (!assetKey) {
    return "";
  }

  const url = new URL(req.url);
  url.pathname = "/api/market-directory/product-media";
  url.search = new URLSearchParams({ asset: assetKey }).toString();
  return url.toString();
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Buffer.from(hash).toString("hex");
}

async function passwordHash(email, password) {
  return sha256(`${text(email).toLowerCase()}:${String(password || "")}`);
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

function trialEndFromCreatedAt(createdAt, days) {
  const parsed = Date.parse(createdAt);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
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
    phone: text(payload.phone),
    website: text(payload.website),
    hours: text(payload.hours),
    logo_image_data_url: text(payload.logo_image_data_url),
    cover_image_data_url: text(payload.cover_image_data_url),
    admin_notes: text(payload.admin_notes),
    requires_age_verification: bool(payload.requires_age_verification),
    minimum_age: int(payload.minimum_age, 18),
    is_live_subscription_active: bool(payload.is_live_subscription_active),
    setup_package_purchased: bool(payload.setup_package_purchased),
    edit_request_credits: int(payload.edit_request_credits, 0),
    beta_service_mode: text(payload.beta_service_mode) || ownerManagedTrialMode,
    beta_trial_ends_at: text(payload.beta_trial_ends_at) || trialEndFromCreatedAt(record.createdAt, 90),
    is_sponsored_by_market_directory: bool(payload.is_sponsored_by_market_directory),
    last_purchase_note: text(payload.last_purchase_note),
    non_public_since: text(payload.non_public_since),
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
    phone: hasOwn(payload, "phone") ? text(payload.phone) : host.phone,
    website: hasOwn(payload, "website") ? text(payload.website) : host.website,
    hours: hasOwn(payload, "hours") ? text(payload.hours) : host.hours,
    logo_image_data_url: hasOwn(payload, "logo_image_data_url") ? text(payload.logo_image_data_url) : host.logo_image_data_url,
    cover_image_data_url: hasOwn(payload, "cover_image_data_url") ? text(payload.cover_image_data_url) : host.cover_image_data_url,
    admin_notes: hasOwn(payload, "admin_notes") ? text(payload.admin_notes) : host.admin_notes,
    requires_age_verification: hasOwn(payload, "requires_age_verification") ? bool(payload.requires_age_verification) : host.requires_age_verification,
    minimum_age: hasOwn(payload, "minimum_age") ? int(payload.minimum_age, host.minimum_age) : host.minimum_age,
    is_live_subscription_active: hasOwn(payload, "is_live_subscription_active") ? bool(payload.is_live_subscription_active) : host.is_live_subscription_active,
    setup_package_purchased: hasOwn(payload, "setup_package_purchased") ? bool(payload.setup_package_purchased) : host.setup_package_purchased,
    edit_request_credits: hasOwn(payload, "edit_request_credits") ? int(payload.edit_request_credits, host.edit_request_credits) : host.edit_request_credits,
    beta_service_mode: text(payload.beta_service_mode) || host.beta_service_mode,
    beta_trial_ends_at: hasOwn(payload, "beta_trial_ends_at") ? text(payload.beta_trial_ends_at) : host.beta_trial_ends_at,
    is_sponsored_by_market_directory: hasOwn(payload, "is_sponsored_by_market_directory") ? bool(payload.is_sponsored_by_market_directory) : host.is_sponsored_by_market_directory,
    last_purchase_note: text(payload.last_purchase_note) || host.last_purchase_note,
    non_public_since: hasOwn(payload, "non_public_since") ? text(payload.non_public_since) : host.non_public_since,
    updated_at: record.createdAt
  };
}

function billingKey(payload) {
  const email = text(payload.email).toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return `business:${text(payload.business_name).toLowerCase()}`;
}

function billingEntitlementsFromRecords(records) {
  const entitlements = new Map();
  const seenTransactions = new Set();

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "billing-receipt") {
      continue;
    }

    const payload = record.payload || {};
    const transactionId = text(payload.transaction_id);
    if (!transactionId || seenTransactions.has(transactionId)) {
      continue;
    }
    seenTransactions.add(transactionId);

    const key = billingKey(payload);
    if (!key || key === "business:") {
      continue;
    }

    if (!entitlements.has(key)) {
      entitlements.set(key, {
        live: false,
        setup: false,
        editCredits: 0,
        lastProductID: "",
        lastTransactionID: "",
        lastPurchasedAt: ""
      });
    }

    const entitlement = entitlements.get(key);
    const productID = text(payload.product_id);
    if (productID === liveStorefrontProductID) {
      entitlement.live = true;
    } else if (productID === setupPackageProductID) {
      entitlement.setup = true;
    } else if (productID === editRequestProductID) {
      entitlement.editCredits += 1;
    }

    entitlement.lastProductID = productID || entitlement.lastProductID;
    entitlement.lastTransactionID = transactionId || entitlement.lastTransactionID;
    entitlement.lastPurchasedAt = text(payload.purchased_at) || entitlement.lastPurchasedAt;
  }

  return entitlements;
}

function applyBillingEntitlements(host, entitlements) {
  const entitlement = entitlements.get(host.key);
  if (!entitlement) {
    return host;
  }

  return {
    ...host,
    is_live_subscription_active: entitlement.live || host.is_live_subscription_active,
    setup_package_purchased: entitlement.setup || host.setup_package_purchased,
    edit_request_credits: Math.max(host.edit_request_credits, entitlement.editCredits),
    last_purchase_note: entitlement.lastTransactionID ? "Billing receipt verified by backend record." : host.last_purchase_note,
    last_purchased_product_id: entitlement.lastProductID,
    last_verified_transaction_id: entitlement.lastTransactionID,
    last_verified_purchase_at: entitlement.lastPurchasedAt
  };
}

async function listStoreHosts() {
  const records = await listStoreJSON(marketDirectoryStore());
  const hosts = new Map();

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "store-host-signup" && record.endpoint !== "storefront-status") {
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

  const billingEntitlements = billingEntitlementsFromRecords(records);

  return Array.from(hosts.values())
    .map((host) => applyBillingEntitlements(host, billingEntitlements))
    .filter((host) => host.status !== "Scheduled for Deletion")
    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

async function listVisibleStoreHostsForRequest(req) {
  const hosts = await listStoreHosts();
  const token = await readToken(bearerToken(req));
  if (token?.role === "admin") {
    return hosts;
  }

  return hosts.filter((host) => {
    return isPubliclyVisible(host) && host.status !== "Frozen";
  });
}

async function storeHostForEmail(email) {
  const normalizedEmail = text(email).toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const records = await listStoreJSON(marketDirectoryStore());
  return records.find((record) => {
    const payload = record.payload || {};
    return record.endpoint === "store-host-signup"
      && text(payload.email).toLowerCase() === normalizedEmail
      && text(payload.password_hash);
  }) || null;
}

async function createStoreHostSession(payload) {
  const email = text(payload.email).toLowerCase();
  const password = String(payload.password || "");
  if (!email || !password) {
    return json({ error: "Email and password are required." }, { status: 400 });
  }

  const hostRecord = await storeHostForEmail(email);
  const expectedHash = text(hostRecord?.payload?.password_hash);
  if (!hostRecord || !expectedHash || expectedHash !== await passwordHash(email, password)) {
    return json({ error: "Invalid store host sign in." }, { status: 401 });
  }

  const token = await createRoleToken("store-host", {
    email,
    storefront_name: text(hostRecord.payload.business_name)
  });
  return json({ ok: true, email, storefront_name: text(hostRecord.payload.business_name), store_host_token: token });
}

function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const ownerPortalAgreementVersion = "owner-portal-agreement-2026-07";

async function managedStoreHostForEmail(email) {
  const normalizedEmail = text(email).toLowerCase();
  if (!normalizedEmail) return null;
  const hosts = await listStoreHosts();
  return hosts.find((host) => text(host.email).toLowerCase() === normalizedEmail) || null;
}

async function latestOwnerAgreementForEmail(email) {
  const normalizedEmail = text(email).toLowerCase();
  if (!normalizedEmail) return null;

  const records = await listStoreJSON(marketDirectoryStore());
  return records.slice().reverse().find((record) => {
    const payload = record.payload || {};
    return record.endpoint === "store-host-agreement-accept"
      && record.status === "accepted"
      && text(payload.email).toLowerCase() === normalizedEmail
      && text(payload.agreement_version) === ownerPortalAgreementVersion;
  }) || null;
}

async function createStoreHostCodeRequest(payload) {
  const email = text(payload.email).toLowerCase();
  if (!email) {
    return json({ error: "Owner email is required." }, { status: 400 });
  }

  const host = await managedStoreHostForEmail(email);
  if (!host) {
    return json({ error: "No managed storefront was found for that owner email." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const code = sixDigitCode();
  const record = {
    id: makeId("market_store_host_code"),
    type: "market-directory",
    endpoint: "store-host-code-request",
    title: email,
    status: "pending",
    createdAt: now,
    payload: {
      email,
      code,
      storefront_name: text(host.business_name),
      owner_name: text(host.owner_name),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  const emailResult = await sendEmail({
    to: email,
    subject: "Your The Market Directory Merchant code",
    text: [
      `Your Merchant sign-in code is ${code}.`,
      "",
      `Storefront: ${text(host.business_name)}`,
      "This code expires in 15 minutes.",
      "",
      "If you did not request this, ignore this email.",
      "American Dev Corp"
    ].join("\n")
  });

  if (!emailResult?.sent) {
    return json({ error: `Merchant code could not be sent: ${emailResult?.reason || "email provider unavailable"}` }, { status: 503 });
  }

  return json({ ok: true, email, storefront_name: text(host.business_name), expires_at: record.payload.expires_at });
}

async function createStoreHostCodeVerify(payload) {
  const email = text(payload.email).toLowerCase();
  const code = text(payload.code);
  if (!email || !code) {
    return json({ error: "Owner email and 6-digit code are required." }, { status: 400 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  const usedRequestIds = new Set(records
    .filter((record) => record.endpoint === "store-host-code-verify" && text(record.payload?.email).toLowerCase() === email)
    .map((record) => text(record.payload?.request_id))
    .filter(Boolean));

  const requestRecord = records.slice().reverse().find((record) => {
    const payload = record.payload || {};
    return record.endpoint === "store-host-code-request"
      && text(payload.email).toLowerCase() === email
      && text(payload.code) === code
      && !usedRequestIds.has(record.id)
      && Date.parse(payload.expires_at || "") > Date.now();
  });

  if (!requestRecord) {
    return json({ error: "Invalid or expired Merchant code." }, { status: 401 });
  }

  const host = await managedStoreHostForEmail(email);
  if (!host) {
    return json({ error: "No managed storefront was found for that owner email." }, { status: 404 });
  }

  const token = await createRoleToken("store-host", {
    email,
    storefront_name: text(host.business_name)
  });

  const verifyRecord = {
    id: makeId("market_store_host_code_verify"),
    type: "market-directory",
    endpoint: "store-host-code-verify",
    title: email,
    status: "used",
    createdAt: new Date().toISOString(),
    payload: {
      email,
      request_id: requestRecord.id,
      storefront_name: text(host.business_name)
    }
  };
  await marketDirectoryStore().setJSON(verifyRecord.id, verifyRecord);

  const agreement = await latestOwnerAgreementForEmail(email);

  return json({
    ok: true,
    email,
    storefront_name: text(host.business_name),
    store_host_token: token,
    agreement_required: !agreement,
    agreement_version: ownerPortalAgreementVersion,
    agreement_accepted_at: agreement?.createdAt || ""
  });
}

async function createStoreHostAgreementAccept(req, payload) {
  const token = await readToken(bearerToken(req));
  if (token?.role !== "store-host") {
    return json({ error: "Merchant sign-in is required before accepting the agreement." }, { status: 401 });
  }

  const email = text(payload.email || token.email).toLowerCase();
  const storefrontName = text(payload.storefront_name || token.storefront_name);
  if (!email || email !== text(token.email).toLowerCase()) {
    return json({ error: "Merchant agreement email does not match the signed-in merchant." }, { status: 403 });
  }

  const host = await managedStoreHostForEmail(email);
  if (!host) {
    return json({ error: "No managed storefront was found for that owner email." }, { status: 404 });
  }

  const existing = await latestOwnerAgreementForEmail(email);
  if (existing) {
    return json({
      ok: true,
      email,
      storefront_name: text(host.business_name),
      agreement_version: ownerPortalAgreementVersion,
      agreement_accepted_at: existing.createdAt,
      already_accepted: true
    });
  }

  const now = new Date().toISOString();
  const record = {
    id: makeId("market_store_host_agreement"),
    type: "market-directory",
    endpoint: "store-host-agreement-accept",
    title: email,
    status: "accepted",
    createdAt: now,
    payload: {
      email,
      storefront_name: storefrontName || text(host.business_name),
      agreement_version: ownerPortalAgreementVersion,
      accepted_at: now,
      accepted_by_role: token.role
    }
  };
  await marketDirectoryStore().setJSON(record.id, record);

  return json({
    ok: true,
    email,
    storefront_name: text(host.business_name),
    agreement_version: ownerPortalAgreementVersion,
    agreement_accepted_at: now,
    already_accepted: false
  });
}

async function listStoreHostAgreements(req) {
  const token = await readToken(bearerToken(req));
  if (token?.role !== "admin" && token?.role !== "store-host") {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  const agreements = records
    .filter((record) => record.endpoint === "store-host-agreement-accept" && record.status === "accepted")
    .filter((record) => {
      if (token.role === "admin") {
        return true;
      }

      return text(record.payload?.email).toLowerCase() === text(token.email).toLowerCase();
    })
    .map((record) => ({
      id: record.id,
      email: text(record.payload?.email).toLowerCase(),
      storefront_name: text(record.payload?.storefront_name),
      agreement_version: text(record.payload?.agreement_version),
      accepted_at: text(record.payload?.accepted_at) || record.createdAt,
      accepted_by_role: text(record.payload?.accepted_by_role)
    }))
    .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));

  return json({ ok: true, agreements });
}

async function createAdminSession(payload) {
  const email = text(payload.email).toLowerCase();
  const allowedEmail = "gilbert.aguirre.office@gmail.com";
  if (email !== allowedEmail) {
    return json({ error: "This email is not authorized." }, { status: 403 });
  }

  if (!adminPasswordMatches(payload.password || "")) {
    return json({ error: "Invalid admin sign in." }, { status: 401 });
  }

  const token = await createRoleToken("admin", { email });
  return json({ ok: true, email, admin_token: token });
}

async function authorizeStorefrontProduct(req, payload) {
  const token = await readToken(bearerToken(req));
  if (token?.role === "admin") {
    return null;
  }

  if (token?.role !== "store-host") {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const hosts = await listStoreHosts();
  const storefrontName = normalizedStorefrontName(payload).toLowerCase();
  const matchingHost = hosts.find((host) => host.business_name.toLowerCase() === storefrontName);
  if (!matchingHost || matchingHost.email.toLowerCase() !== text(token.email).toLowerCase()) {
    return json({ error: "Store host token does not match this storefront." }, { status: 403 });
  }

  return null;
}

function validateStorefrontProductPayload(payload) {
  const requiredFields = [
    ["storefront_name", "Storefront name"],
    ["product_title", "Product title"],
    ["product_description", "Product description"],
    ["price", "Price"],
    ["turnaround_time", "Turnaround time"],
    ["lead_time", "Lead time"]
  ];

  const missing = requiredFields
    .filter(([key]) => !text(payload[key]))
    .map(([, label]) => label);

  if (missing.length > 0) {
    return json({ error: `Missing required product fields: ${missing.join(", ")}.` }, { status: 400 });
  }

  return null;
}

async function authorizeBillingReceipt(req, payload) {
  const productID = text(payload.product_id);
  const transactionID = text(payload.transaction_id);
  if (!knownBillingProductIDs.has(productID) || !transactionID) {
    return json({ error: "A known product_id and transaction_id are required." }, { status: 400 });
  }

  const token = await readToken(bearerToken(req));
  if (token?.role === "admin") {
    return null;
  }

  if (token?.role !== "store-host") {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = text(payload.email).toLowerCase();
  const storefrontName = text(payload.business_name).toLowerCase();
  if (email !== text(token.email).toLowerCase() || storefrontName !== text(token.storefront_name).toLowerCase()) {
    return json({ error: "Store host token does not match this billing receipt." }, { status: 403 });
  }

  return null;
}

async function existingBillingReceiptForTransaction(transactionID) {
  const normalizedTransactionID = text(transactionID);
  if (!normalizedTransactionID) {
    return null;
  }

  const records = await listStoreJSON(marketDirectoryStore());
  return records.find((record) => {
    const payload = record.payload || {};
    return record.endpoint === "billing-receipt" && text(payload.transaction_id) === normalizedTransactionID;
  }) || null;
}

function isPubliclyVisible(host) {
  if (host.is_live_subscription_active || host.is_sponsored_by_market_directory) {
    return true;
  }

  if (!host.beta_trial_ends_at || host.beta_service_mode === "No Trial") {
    return false;
  }

  const trialEndsAt = Date.parse(host.beta_trial_ends_at);
  return Number.isFinite(trialEndsAt) && trialEndsAt >= Date.now();
}

function normalizedStorefrontName(payload) {
  return text(payload.storefront_name || payload.business_name);
}

function productFromRecord(record, req) {
  const payload = record.payload || {};
  const storefrontName = normalizedStorefrontName(payload);
  const productTitle = text(payload.product_title);

  if (!storefrontName || !productTitle) {
    return null;
  }

  return {
    product_id: text(payload.product_id) || record.id,
    storefront_name: storefrontName,
    product_title: productTitle,
    product_description: text(payload.product_description),
    price: text(payload.price),
    turnaround_time: text(payload.turnaround_time),
    lead_time: text(payload.lead_time),
    product_notes: text(payload.product_notes),
    media_notes: text(payload.media_notes),
    product_image_url: text(payload.product_image_url) || mediaURL(req, text(payload.product_image_asset_key)),
    product_photo_urls: textArray(payload.product_photo_urls),
    icon: text(payload.icon) || "shippingbox.fill",
    status: text(payload.status) || "listed",
    review_note: text(payload.review_note),
    reviewed_by: text(payload.reviewed_by),
    reviewed_at: text(payload.reviewed_at),
    created_at: record.createdAt,
    updated_at: text(payload.updated_at) || record.createdAt
  };
}

function productSortTimestamp(product) {
  return String(product.updated_at || product.created_at || "");
}

function setLatestProduct(productsByID, product) {
  const existing = productsByID.get(product.product_id);
  if (!existing || productSortTimestamp(product).localeCompare(productSortTimestamp(existing)) >= 0) {
    productsByID.set(product.product_id, product);
  }
}

function orderFromRecord(record) {
  const payload = record.payload || {};
  const storefrontName = normalizedStorefrontName(payload);
  const orderId = text(payload.order_id) || record.id;

  if (!storefrontName || !orderId) {
    return null;
  }

  return {
    order_id: orderId,
    storefront_name: storefrontName,
    consumer_email: text(payload.consumer_email),
    consumer_name: text(payload.consumer_name),
    consumer_phone: text(payload.consumer_phone),
    consumer_address: text(payload.consumer_address),
    status: text(payload.status) || "Received",
    merchant_note: text(payload.merchant_note),
    fulfillment_type: text(payload.fulfillment_type) || "Pickup / Delivery / Shipping TBD",
    submitted_at: text(payload.submitted_at) || record.createdAt,
    updated_at: text(payload.updated_at) || record.createdAt,
    items: Array.isArray(payload.items) ? payload.items.map((item) => ({
      product_title: text(item.product_title),
      quantity: int(item.quantity, 1),
      note: text(item.note)
    })).filter((item) => item.product_title) : [],
    timeline: Array.isArray(payload.timeline) ? payload.timeline : []
  };
}

async function listStorefrontOrders(req) {
  const records = await listStoreJSON(marketDirectoryStore());
  const url = new URL(req.url);
  const storefrontFilter = text(url.searchParams.get("storefront_name")).toLowerCase();
  const consumerFilter = text(url.searchParams.get("consumer_email")).toLowerCase();
  const auth = await readToken(bearerToken(req));
  const latestOrders = new Map();

  for (const record of records) {
    if (record.endpoint !== "storefront-order" && record.endpoint !== "storefront-order-update") {
      continue;
    }

    const order = orderFromRecord(record);
    if (!order) {
      continue;
    }

    const key = order.order_id;
    const existing = latestOrders.get(key);
    if (!existing || String(order.updated_at).localeCompare(String(existing.updated_at)) >= 0) {
      latestOrders.set(key, order);
    }
  }

  let orders = Array.from(latestOrders.values());
  if (auth?.role === "store-host") {
    const owned = text(auth.storefront_name).toLowerCase();
    orders = orders.filter((order) => order.storefront_name.toLowerCase() === owned);
  } else if (auth?.role !== "admin") {
    if (!consumerFilter) {
      return json({ error: "Order history requires a signed-in merchant/admin or consumer email filter." }, { status: 401 });
    }
    if (storefrontFilter) {
      orders = orders.filter((order) => order.storefront_name.toLowerCase() === storefrontFilter);
    }
    orders = orders.filter((order) => order.consumer_email.toLowerCase() === consumerFilter);
  }

  return json({
    ok: true,
    storefront_orders: orders.sort((a, b) => String(b.updated_at || b.submitted_at).localeCompare(String(a.updated_at || a.submitted_at)))
  });
}

function merchantContactFromRecord(record) {
  const payload = record.payload || {};
  const storefrontName = normalizedStorefrontName(payload);
  const contactId = text(payload.contact_id) || text(payload.customer_email).toLowerCase() || record.id;

  if (!storefrontName || !contactId) {
    return null;
  }

  return {
    contact_id: contactId,
    storefront_name: storefrontName,
    customer_name: text(payload.customer_name),
    customer_email: text(payload.customer_email),
    customer_phone: text(payload.customer_phone),
    customer_address: text(payload.customer_address),
    updated_at: text(payload.updated_at) || record.createdAt
  };
}

async function authorizeMerchantContact(req, payload) {
  const token = await readToken(bearerToken(req));
  if (token?.role === "admin") {
    return null;
  }

  if (token?.role === "store-host" && text(token.storefront_name).toLowerCase() === normalizedStorefrontName(payload).toLowerCase()) {
    return null;
  }

  return json({ error: "Merchant contact access requires admin or matching merchant token." }, { status: 401 });
}

async function listMerchantContacts(req) {
  const token = await readToken(bearerToken(req));
  if (!token || (token.role !== "admin" && token.role !== "store-host")) {
    return json({ error: "Merchant contacts require signed-in merchant or admin access." }, { status: 401 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  const url = new URL(req.url);
  const storefrontFilter = token.role === "store-host"
    ? text(token.storefront_name).toLowerCase()
    : text(url.searchParams.get("storefront_name")).toLowerCase();
  const latestContacts = new Map();

  for (const record of records) {
    const contact = record.endpoint === "merchant-contact"
      ? merchantContactFromRecord(record)
      : null;
    if (!contact) {
      continue;
    }

    if (storefrontFilter && contact.storefront_name.toLowerCase() !== storefrontFilter) {
      continue;
    }

    const key = `${contact.storefront_name.toLowerCase()}:${contact.contact_id.toLowerCase()}`;
    const existing = latestContacts.get(key);
    if (!existing || String(contact.updated_at).localeCompare(String(existing.updated_at)) >= 0) {
      latestContacts.set(key, contact);
    }
  }

  return json({
    ok: true,
    merchant_contacts: Array.from(latestContacts.values()).sort((a, b) => a.customer_name.localeCompare(b.customer_name))
  });
}

async function listStorefrontProducts(req) {
  const [records, hosts] = await Promise.all([
    listStoreJSON(marketDirectoryStore()),
    listStoreHosts()
  ]);
  const publicHostNames = new Set(
    hosts
      .filter(isPubliclyVisible)
      .map((host) => host.business_name.toLowerCase())
  );

  const latestProducts = new Map();
  for (const record of records) {
    if (record.endpoint !== "storefront-product") {
      continue;
    }

    const product = productFromRecord(record, req);
    if (product) {
      setLatestProduct(latestProducts, product);
    }
  }

  return Array.from(latestProducts.values())
    .filter((product) => product.status === "listed" && publicHostNames.has(product.storefront_name.toLowerCase()))
    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

async function listProductsForReview(req) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const records = await listStoreJSON(marketDirectoryStore());
  const latestProducts = new Map();
  for (const record of records) {
    if (record.endpoint !== "storefront-product") {
      continue;
    }

    const product = productFromRecord(record, req);
    if (product) {
      setLatestProduct(latestProducts, product);
    }
  }

  const reviewableStatuses = new Set(["pending_review", "rejected"]);
  return json({
    ok: true,
    storefront_products: Array.from(latestProducts.values())
      .filter((product) => reviewableStatuses.has(product.status))
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))
  });
}

async function listOwnedStorefrontProducts(req) {
  const token = await readToken(bearerToken(req));
  if (token?.role !== "store-host" && token?.role !== "admin") {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownedStorefrontName = text(token.storefront_name).toLowerCase();
  if (token.role === "store-host" && !ownedStorefrontName) {
    return json({ error: "Store host token is missing storefront authority." }, { status: 403 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  const latestProducts = new Map();
  for (const record of records) {
    if (record.endpoint !== "storefront-product") {
      continue;
    }

    const product = productFromRecord(record, req);
    if (product) {
      setLatestProduct(latestProducts, product);
    }
  }

  return json({
    ok: true,
    storefront_products: Array.from(latestProducts.values())
      .filter((product) => token.role === "admin" || product.storefront_name.toLowerCase() === ownedStorefrontName)
      .filter((product) => product.status !== "removed")
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))
  });
}

async function listStorefrontAnalytics() {
  const [records, hosts] = await Promise.all([
    listStoreJSON(marketDirectoryStore()),
    listStoreHosts()
  ]);
  const publicHostsByName = new Map(
    hosts
      .filter(isPubliclyVisible)
      .map((host) => [host.business_name.toLowerCase(), host])
  );
  const analyticsByName = new Map();
  const upvotesByStorefront = new Map();

  function analyticsFor(storefrontName) {
    const key = storefrontName.toLowerCase();
    if (!publicHostsByName.has(key)) {
      return null;
    }

    if (!analyticsByName.has(key)) {
      const host = publicHostsByName.get(key);
      analyticsByName.set(key, {
        storefront_name: host.business_name,
        open_count: 0,
        message_count: 0,
        upvote_count: 0,
        is_adc_hosted: host.beta_service_mode === "90-Day American Dev Corp Managed Trial" || host.setup_package_purchased === true
      });
    }

    return analyticsByName.get(key);
  }

  for (const record of records.slice().reverse()) {
    const payload = record.payload || {};
    const storefrontName = normalizedStorefrontName(payload);
    if (!storefrontName) {
      continue;
    }

    const analytics = analyticsFor(storefrontName);
    if (!analytics) {
      continue;
    }

    if (record.endpoint === "storefront-open") {
      analytics.open_count += 1;
    } else if (record.endpoint === "message") {
      analytics.message_count += 1;
    } else if (record.endpoint === "storefront-upvote") {
      const voterKey = text(payload.consumer_email).toLowerCase() || record.id;
      const storeKey = storefrontName.toLowerCase();
      if (!upvotesByStorefront.has(storeKey)) {
        upvotesByStorefront.set(storeKey, new Map());
      }
      upvotesByStorefront.get(storeKey).set(voterKey, bool(payload.upvoted));
    }
  }

  for (const [storeKey, votes] of upvotesByStorefront.entries()) {
    const analytics = analyticsByName.get(storeKey);
    if (analytics) {
      analytics.upvote_count = Array.from(votes.values()).filter(Boolean).length;
    }
  }

  return Array.from(analyticsByName.values()).sort((a, b) => {
    const aTotal = a.open_count + a.message_count + a.upvote_count;
    const bTotal = b.open_count + b.message_count + b.upvote_count;
    if (aTotal === bTotal) {
      return a.storefront_name.localeCompare(b.storefront_name);
    }
    return bTotal - aTotal;
  });
}

async function dailyWatchSummary() {
  const [records, hosts] = await Promise.all([
    listStoreJSON(marketDirectoryStore()),
    listStoreHosts()
  ]);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const isToday = (record) => {
    const timestamp = Date.parse(record.createdAt);
    return Number.isFinite(timestamp) && timestamp >= todayStart;
  };

  return {
    app_downloads: null,
    active_storefronts: hosts.filter((host) => isPubliclyVisible(host) && host.status !== "Frozen" && host.status !== "Scheduled for Deletion").length,
    frozen_storefronts: hosts.filter((host) => host.status === "Frozen").length,
    pending_deletion: hosts.filter((host) => host.status === "Scheduled for Deletion").length,
    total_storefront_views: records.filter((record) => record.endpoint === "storefront-open" && isToday(record)).length,
    total_storefronts_messaged: records.filter((record) => record.endpoint === "message" && isToday(record)).length,
    refreshed_at: new Date().toISOString()
  };
}

function parseDataURL(dataURL) {
  const match = String(dataURL || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function storeProductImage(req, payload) {
  const image = parseDataURL(payload.product_image_data_url);
  if (!image) {
    delete payload.product_image_data_url;
    return null;
  }

  if (!allowedProductImageContentTypes.has(image.contentType)) {
    return json({ error: "Product image must be a JPEG or PNG." }, { status: 415 });
  }

  if (image.buffer.byteLength > maxProductImageBytes) {
    return json({ error: "Product image is too large. Upload an image smaller than 5 MB." }, { status: 413 });
  }

  const productId = text(payload.product_id) || makeId("product");
  payload.product_id = productId;
  const extension = image.contentType.includes("png") ? "png" : "jpg";
  const assetKey = `product-images/${productId}/${makeId("image")}.${extension}`;
  await marketDirectoryMediaStore().set(assetKey, image.buffer, {
    metadata: {
      contentType: image.contentType,
      productId,
      storefrontName: normalizedStorefrontName(payload)
    }
  });

  payload.product_image_asset_key = assetKey;
  payload.product_image_url = mediaURL(req, assetKey);
  delete payload.product_image_data_url;
  return null;
}

async function storeProductPhotoSet(req, payload) {
  const incomingDataURLs = textArray(payload.product_photo_data_urls);
  const incomingURLs = textArray(payload.product_photo_urls);

  if (!incomingDataURLs.some(Boolean)) {
    payload.product_photo_urls = incomingURLs;
    delete payload.product_photo_data_urls;
    return null;
  }

  const productId = text(payload.product_id) || makeId("product");
  payload.product_id = productId;
  const storedURLs = [];

  for (let index = 0; index < 3; index += 1) {
    const dataURL = incomingDataURLs[index] || "";
    if (!dataURL) {
      storedURLs[index] = incomingURLs[index] || "";
      continue;
    }

    const image = parseDataURL(dataURL);
    if (!image) {
      storedURLs[index] = "";
      continue;
    }

    if (!allowedProductImageContentTypes.has(image.contentType)) {
      return json({ error: "Product images must be JPEG or PNG." }, { status: 415 });
    }

    if (image.buffer.byteLength > maxProductImageBytes) {
      return json({ error: "One product image is too large. Upload images smaller than 5 MB." }, { status: 413 });
    }

    const extension = image.contentType.includes("png") ? "png" : "jpg";
    const assetKey = `product-images/${productId}/slot-${index + 1}-${makeId("image")}.${extension}`;
    await marketDirectoryMediaStore().set(assetKey, image.buffer, {
      metadata: {
        contentType: image.contentType,
        productId,
        storefrontName: normalizedStorefrontName(payload),
        slot: String(index + 1)
      }
    });

    storedURLs[index] = mediaURL(req, assetKey);
  }

  payload.product_photo_urls = storedURLs;
  payload.product_image_url = storedURLs.find(Boolean) || text(payload.product_image_url);
  delete payload.product_photo_data_urls;
  return null;
}

export default async (req) => {
  const endpoint = endpointFromRequest(req);

  if (req.method === "GET") {
    if (endpoint === "store-hosts") {
      return json({ ok: true, store_hosts: await listVisibleStoreHostsForRequest(req) });
    }

    if (endpoint === "storefront-analytics") {
      return json({ ok: true, storefront_analytics: await listStorefrontAnalytics() });
    }

    if (endpoint === "daily-watch") {
      return json({ ok: true, daily_watch: await dailyWatchSummary() });
    }

    if (endpoint === "store-host-agreements") {
      return listStoreHostAgreements(req);
    }

    if (endpoint === "storefront-products") {
      return json({ ok: true, storefront_products: await listStorefrontProducts(req) });
    }

    if (endpoint === "storefront-products-owned") {
      return listOwnedStorefrontProducts(req);
    }

    if (endpoint === "storefront-products-review") {
      return listProductsForReview(req);
    }

    if (endpoint === "storefront-orders") {
      return listStorefrontOrders(req);
    }

    if (endpoint === "merchant-contacts") {
      return listMerchantContacts(req);
    }

    if (endpoint === "product-media") {
      const assetKey = new URL(req.url).searchParams.get("asset") || "";
      const blob = assetKey ? await marketDirectoryMediaStore().getWithMetadata(assetKey, { type: "arrayBuffer" }) : null;
      if (!blob?.data) {
        return json({ error: "Media not found" }, { status: 404 });
      }

      return new Response(blob.data, {
        headers: {
          "Content-Type": blob.metadata?.contentType || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!allowedEndpoints.has(endpoint)) {
    return json({ error: "Unknown Market Directory endpoint" }, { status: 404 });
  }

  const payload = await readJSON(req);

  if (endpoint === "store-host-session") {
    return createStoreHostSession(payload);
  }

  if (endpoint === "store-host-code-request") {
    return createStoreHostCodeRequest(payload);
  }

  if (endpoint === "store-host-code-verify") {
    return createStoreHostCodeVerify(payload);
  }

  if (endpoint === "store-host-agreement-accept") {
    return createStoreHostAgreementAccept(req, payload);
  }

  if (endpoint === "admin-session") {
    return createAdminSession(payload);
  }

  if (adminWriteEndpoints.has(endpoint)) {
    const unauthorized = await requireAdmin(req);
    if (unauthorized) return unauthorized;
  }

  if (endpoint === "storefront-product") {
    const unauthorized = await authorizeStorefrontProduct(req, payload);
    if (unauthorized) return unauthorized;
    const invalidProduct = validateStorefrontProductPayload(payload);
    if (invalidProduct) return invalidProduct;
    const photoSetError = await storeProductPhotoSet(req, payload);
    if (photoSetError) return photoSetError;
    const imageError = await storeProductImage(req, payload);
    if (imageError) return imageError;
  }

  if (endpoint === "merchant-contact") {
    const unauthorized = await authorizeMerchantContact(req, payload);
    if (unauthorized) return unauthorized;
    payload.updated_at = new Date().toISOString();
  }

  if (endpoint === "storefront-order-update") {
    const unauthorized = await authorizeMerchantContact(req, payload);
    if (unauthorized) return unauthorized;
    payload.updated_at = new Date().toISOString();
  }

  if (endpoint === "billing-receipt") {
    const unauthorized = await authorizeBillingReceipt(req, payload);
    if (unauthorized) return unauthorized;

    const existingReceipt = await existingBillingReceiptForTransaction(payload.transaction_id);
    if (existingReceipt) {
      return json({ ok: true, id: existingReceipt.id, duplicate: true });
    }
  }

  if (endpoint === "store-host-signup" && payload.password) {
    payload.password_hash = await passwordHash(payload.email, payload.password);
    delete payload.password;
  }

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

  if (["support-request", "host-access-request", "store-host-signup", "storefront-status", "sponsorship-request", "storefront-review", "storefront-order", "storefront-product", "billing-receipt"].includes(endpoint)) {
    await sendOperationalEmail(adminMarketDirectoryEmail(record));
  }

  if (endpoint === "storefront-product" && ["listed", "rejected"].includes(text(payload.status)) && text(payload.store_host_email)) {
    await sendOperationalEmail(marketDirectoryProductDecisionEmail(record));
  }

  return json({ ok: true, id: record.id });
};

export const config = {
  path: "/api/market-directory/:endpoint"
};
