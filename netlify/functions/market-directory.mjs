import { adminMarketDirectoryEmail, hostAccessCodeEmail, hostAccessDeniedEmail, sendEmail } from "./_shared/email.mjs";
import { json, readJSON } from "./_shared/json.mjs";
import { hostAccessCodeStore, listStoreJSON, makeId, marketDirectoryStore } from "./_shared/storage.mjs";
import { bearerToken, createAppToken, isAdmin, requireAppAuth, verifyAppToken } from "./_shared/app-auth.mjs";
import { claimTransactionOnce, verifyAppStoreTransaction } from "./_shared/app-store.mjs";
import {
  bool,
  hasOwn,
  int,
  listConsumers,
  listStoreHosts,
  resolveConsumerByEmail,
  resolveStoreHostByEmail,
  resolveStoreHostByKey,
  storefrontKey,
  text
} from "./_shared/market-directory-data.mjs";

const adcBundleId = "american-dev-corp.The-Market-Directory";

// Apple product identifiers that grant an effect once a receipt is verified against Apple.
// These follow the bundle ID convention used elsewhere in this codebase but are NOT confirmed
// against what's actually configured in App Store Connect — update to match before shipping.
const productEffects = {
  [`${adcBundleId}.live_subscription_monthly`]: { field: "is_live_subscription_active", value: true },
  [`${adcBundleId}.setup_package`]: { field: "setup_package_purchased", value: true },
  [`${adcBundleId}.edit_request_credit`]: { field: "edit_request_credits", delta: 1 }
};

// Fields a Store Host may set on their own storefront. Billing/monetary fields are deliberately
// excluded — those only ever change via an admin action or a verified billing-receipt purchase,
// never from a host's own direct storefront-status call. See the audit finding this closes:
// "the backend checks no credentials on any endpoint" (storefront-status could grant free
// subscriptions and edit credits to anyone who called it).
const hostSelfEditableFields = ["business_summary", "category_name", "city", "state", "requires_age_verification", "minimum_age"];
const hostSelfAllowedStatus = new Set(["Active", "Not Public"]);
const hostAdminOnlyFields = ["is_live_subscription_active", "setup_package_purchased", "edit_request_credits", "is_sponsored_by_market_directory", "last_purchase_note"];

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
  "billing-receipt",
  "product",
  "consumers",
  "account-delete"
]);

function endpointFromRequest(req) {
  const pathname = new URL(req.url).pathname;
  return pathname.split("/").filter(Boolean).at(-1) || "";
}

async function optionalClaims(req) {
  const token = bearerToken(req);
  return token ? verifyAppToken(token) : null;
}

// Resolves "which storefront is this about" from whatever shape of identifying fields a caller
// sends — a storefront_key from a client that already has one, or an email/business_name from
// one that doesn't. Shared by every endpoint that acts on a storefront a consumer is looking at.
async function resolveHostFromPayload(payload) {
  if (text(payload.storefront_key)) {
    return resolveStoreHostByKey(text(payload.storefront_key));
  }

  const byEmail = text(payload.email) ? await resolveStoreHostByEmail(payload.email) : null;
  if (byEmail) {
    return byEmail;
  }

  const name = text(payload.business_name) || text(payload.storefront_name);
  return name ? resolveStoreHostByKey(storefrontKey({ business_name: name })) : null;
}

// Pre-rewrite message/upvote/review records never had a normalized storefront_key — this
// reconstructs the same key from whatever fields that record actually has, so old rows stay
// readable under the new keyed folding instead of silently disappearing.
function legacyStorefrontKey(payload) {
  if (text(payload.storefront_key)) {
    return payload.storefront_key;
  }
  const name = text(payload.business_name) || text(payload.storefront_name);
  return name ? storefrontKey({ business_name: name }) : storefrontKey({ email: payload.email });
}

function conversationId(consumerEmail, hostKey) {
  return `conv:${text(consumerEmail).toLowerCase()}::${hostKey}`;
}

function legacyConversationId(payload) {
  if (text(payload.conversation_id)) {
    return text(payload.conversation_id);
  }
  const hostKey = legacyStorefrontKey(payload);
  const consumerEmail = text(payload.email || payload.consumer_email).toLowerCase();
  return hostKey && consumerEmail ? conversationId(consumerEmail, hostKey) : null;
}

async function upvoteState(hostKey, forEmail) {
  const records = await listStoreJSON(marketDirectoryStore());
  const latestByVoter = new Map();

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "storefront-upvote") continue;
    if (legacyStorefrontKey(record.payload) !== hostKey) continue;

    const voter = text(record.payload.consumer_email || record.payload.email).toLowerCase();
    if (!voter) continue;
    latestByVoter.set(voter, hasOwn(record.payload, "upvoted") ? bool(record.payload.upvoted) : true);
  }

  return {
    count: Array.from(latestByVoter.values()).filter(Boolean).length,
    upvotedByMe: forEmail ? latestByVoter.get(forEmail.toLowerCase()) === true : false
  };
}

// Folds product create + remove events into current state, exactly like listStoreHosts folds
// signup + status events — a create event seeds the map keyed by its own record id; a remove
// event (carrying product_id instead) marks that seed removed. When storefrontFilterKey is set,
// only that storefront's creates are seeded (a stray remove for a different storefront's product
// is a safe no-op, since it was never seeded into the map to begin with).
function foldProducts(records, storefrontFilterKey) {
  const products = new Map();

  for (const record of records.slice().reverse()) {
    if (record.endpoint !== "product") continue;
    const payload = record.payload || {};

    if (payload.product_id) {
      const existing = products.get(payload.product_id);
      if (existing && payload.action === "remove") {
        products.set(payload.product_id, { ...existing, removed: true });
      }
      continue;
    }

    if (storefrontFilterKey && payload.storefront_key !== storefrontFilterKey) continue;

    products.set(record.id, {
      id: record.id,
      storefront_key: payload.storefront_key,
      business_name: text(payload.business_name),
      name: text(payload.name),
      description: text(payload.description),
      price: text(payload.price),
      category: text(payload.category),
      photo_urls: Array.isArray(payload.photo_urls) ? payload.photo_urls.filter((url) => typeof url === "string") : [],
      removed: false,
      created_at: record.createdAt
    });
  }

  return Array.from(products.values())
    .filter((product) => !product.removed)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function resolveProductOwnerKey(productId) {
  const records = await listStoreJSON(marketDirectoryStore());
  const seed = records.find((record) => record.endpoint === "product" && !record.payload.product_id && record.id === productId);
  return seed ? seed.payload.storefront_key : null;
}

async function updateRequestStatus(id, expectedEndpoint, status) {
  const record = await marketDirectoryStore().get(id, { type: "json" });
  if (!record || record.endpoint !== expectedEndpoint) {
    return json({ error: "Request not found." }, { status: 404 });
  }
  await marketDirectoryStore().setJSON(id, { ...record, status: text(status) });
  return json({ ok: true, id, status: text(status) });
}

function generateAccessCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function resolveHostAccessRequest(id, action) {
  if (!["approve", "deny"].includes(action)) {
    return json({ error: "action must be approve or deny." }, { status: 400 });
  }

  const record = await marketDirectoryStore().get(id, { type: "json" });
  if (!record || record.endpoint !== "host-access-request") {
    return json({ error: "Request not found." }, { status: 404 });
  }

  const email = text(record.payload.email).toLowerCase();
  const businessName = text(record.payload.business_name);

  await marketDirectoryStore().setJSON(id, { ...record, status: action === "approve" ? "approved" : "denied" });

  if (action === "deny") {
    await sendEmail({ to: email, ...hostAccessDeniedEmail({ businessName }) });
    return json({ ok: true, id, status: "denied" });
  }

  const code = generateAccessCode();
  await hostAccessCodeStore().setJSON(email, {
    code,
    businessName,
    requestId: id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  });

  await sendEmail({ to: email, ...hostAccessCodeEmail({ businessName, code }) });
  return json({ ok: true, id, status: "approved" });
}

// ---------- GET handlers ----------

const hostPublicFields = ["business_name", "owner_name", "category_name", "city", "state", "business_summary", "requires_age_verification", "minimum_age", "is_sponsored_by_market_directory", "status", "key", "created_at", "updated_at"];

function publicHostView(host) {
  const view = {};
  for (const field of hostPublicFields) view[field] = host[field];
  return view;
}

async function handleGetStoreHosts(req) {
  const [hosts, claims] = await Promise.all([listStoreHosts(), optionalClaims(req)]);

  const visible = hosts.map((host) => {
    if (isAdmin(claims) || (claims && claims.role === "store-host" && claims.email === host.email)) {
      return host;
    }
    return publicHostView(host);
  });

  return json({ ok: true, store_hosts: visible });
}

async function handleGetConsumers(req) {
  const { unauthorized } = await requireAppAuth(req, "admin");
  if (unauthorized) return unauthorized;
  return json({ ok: true, consumers: await listConsumers() });
}

async function handleGetProduct(req) {
  const url = new URL(req.url);
  const storefront = url.searchParams.get("storefront") || "";
  if (!storefront) {
    return json({ error: "storefront query param is required." }, { status: 400 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  return json({ ok: true, products: foldProducts(records, storefront) });
}

async function handleGetReviews(req) {
  const url = new URL(req.url);
  const storefront = url.searchParams.get("storefront") || "";
  if (!storefront) {
    return json({ error: "storefront query param is required." }, { status: 400 });
  }

  const records = await listStoreJSON(marketDirectoryStore());
  const reviews = records
    .filter((record) => record.endpoint === "storefront-review" && legacyStorefrontKey(record.payload) === storefront)
    .map((record) => ({
      id: record.id,
      rating: int(record.payload.rating, 0),
      body: text(record.payload.body),
      reviewer_name: text(record.payload.reviewer_name) || "A shopper",
      purchased: bool(record.payload.purchased),
      created_at: record.createdAt
    }));

  return json({ ok: true, reviews });
}

async function handleGetUpvoteState(req) {
  const url = new URL(req.url);
  const storefront = url.searchParams.get("storefront") || "";
  if (!storefront) {
    return json({ error: "storefront query param is required." }, { status: 400 });
  }

  const claims = await optionalClaims(req);
  const { count, upvotedByMe } = await upvoteState(storefront, claims?.email);
  return json({ ok: true, storefront, count, upvoted_by_me: upvotedByMe });
}

async function handleGetMessages(req) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const conversationParam = url.searchParams.get("conversation_id") || "";
  const records = await listStoreJSON(marketDirectoryStore());
  const messageRecords = records.filter((record) => record.endpoint === "message");
  const myHostKey = claims.role === "store-host" ? (await resolveStoreHostByEmail(claims.email))?.key : null;

  if (conversationParam) {
    const match = conversationParam.match(/^conv:(.+)::(.+)$/);
    if (!match) return json({ error: "Invalid conversation." }, { status: 400 });
    const [, consumerEmail, hostKey] = match;

    const isParticipant = claims.role === "admin"
      || (claims.role === "consumer" && claims.email === consumerEmail)
      || (claims.role === "store-host" && myHostKey === hostKey);

    if (!isParticipant) {
      return json({ error: "Not authorized for this conversation." }, { status: 403 });
    }

    const thread = messageRecords
      .filter((record) => (legacyConversationId(record.payload)) === conversationParam)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((record) => ({
        id: record.id,
        sender_role: record.payload.sender_role || "consumer",
        sender_email: record.payload.sender_email || record.payload.email,
        body: record.payload.body,
        created_at: record.createdAt
      }));

    return json({ ok: true, conversation_id: conversationParam, messages: thread });
  }

  const latestByConversation = new Map();
  for (const record of messageRecords.slice().reverse()) {
    const cid = legacyConversationId(record.payload);
    const match = cid && cid.match(/^conv:(.+)::(.+)$/);
    if (!match) continue;
    const [, consumerEmail, hostKey] = match;

    if (claims.role === "consumer" && consumerEmail !== claims.email) continue;
    if (claims.role === "store-host" && hostKey !== myHostKey) continue;

    latestByConversation.set(cid, {
      conversation_id: cid,
      consumer_email: consumerEmail,
      storefront_key: hostKey,
      last_message: text(record.payload.body).slice(0, 140),
      last_sender_role: record.payload.sender_role || "consumer",
      updated_at: record.createdAt
    });
  }

  return json({ ok: true, conversations: Array.from(latestByConversation.values()) });
}

async function handleGetRequests(req, endpoint) {
  const { unauthorized } = await requireAppAuth(req, "admin");
  if (unauthorized) return unauthorized;
  const records = await listStoreJSON(marketDirectoryStore());
  return json({ ok: true, requests: records.filter((record) => record.endpoint === endpoint) });
}

// ---------- POST handlers ----------

async function handleConsumerProfileUpdate(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req, "consumer");
  if (unauthorized) return unauthorized;

  const record = {
    id: makeId("market_consumer_signup"),
    type: "market-directory",
    endpoint: "consumer-signup",
    title: claims.email,
    status: "updated",
    createdAt: new Date().toISOString(),
    payload: {
      email: claims.email,
      first_name: text(payload.first_name),
      last_name: text(payload.last_name),
      address: text(payload.address)
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  const updated = await resolveConsumerByEmail(claims.email);
  return json({ ok: true, first_name: updated?.first_name || "", last_name: updated?.last_name || "", address: updated?.address || "" });
}

async function handleStoreHostSignup(payload) {
  const email = text(payload.email).toLowerCase();
  const code = text(payload.code);

  if (!email || !code) {
    return json({ error: "Email and access code are required." }, { status: 400 });
  }

  const stored = await hostAccessCodeStore().get(email, { type: "json" });
  if (!stored || stored.code !== code || new Date(stored.expiresAt).getTime() < Date.now()) {
    return json({ error: "Invalid or expired access code." }, { status: 401 });
  }

  const businessName = text(payload.business_name) || stored.businessName;
  if (!businessName) {
    return json({ error: "business_name is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const record = {
    id: makeId("market_store_host_signup"),
    type: "market-directory",
    endpoint: "store-host-signup",
    title: businessName,
    status: "new",
    createdAt: now,
    payload: {
      business_name: businessName,
      owner_name: text(payload.owner_name),
      email,
      status: "Active",
      category_name: text(payload.category_name) || "Local Services",
      city: text(payload.city),
      state: text(payload.state),
      business_summary: text(payload.business_summary),
      requires_age_verification: bool(payload.requires_age_verification),
      minimum_age: int(payload.minimum_age, 18)
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await hostAccessCodeStore().delete(email);
  await sendEmail(adminMarketDirectoryEmail(record));

  const token = await createAppToken({ role: "store-host", email });
  return json({ ok: true, id: record.id, token, business_name: businessName });
}

async function handlePostHostAccessRequest(req, payload) {
  if (text(payload.id) && text(payload.action)) {
    const { unauthorized } = await requireAppAuth(req, "admin");
    if (unauthorized) return unauthorized;
    return resolveHostAccessRequest(text(payload.id), text(payload.action));
  }

  const businessName = text(payload.business_name);
  const email = text(payload.email).toLowerCase();
  if (!businessName || !email) {
    return json({ error: "business_name and email are required." }, { status: 400 });
  }

  const record = {
    id: makeId("market_host_access_request"),
    type: "market-directory",
    endpoint: "host-access-request",
    title: businessName,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: { ...payload, business_name: businessName, email }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await sendEmail(adminMarketDirectoryEmail(record));
  return json({ ok: true, id: record.id });
}

async function handlePostSupportRequest(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  if (text(payload.id) && text(payload.status)) {
    if (!isAdmin(claims)) return json({ error: "Not authorized for this action." }, { status: 403 });
    return updateRequestStatus(text(payload.id), "support-request", payload.status);
  }

  const record = {
    id: makeId("market_support_request"),
    type: "market-directory",
    endpoint: "support-request",
    title: text(payload.topic) || claims.email,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: { ...payload, email: claims.email, role: claims.role }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await sendEmail(adminMarketDirectoryEmail(record));
  return json({ ok: true, id: record.id });
}

async function handlePostSponsorshipRequest(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  if (text(payload.id) && text(payload.status)) {
    if (!isAdmin(claims)) return json({ error: "Not authorized for this action." }, { status: 403 });
    return updateRequestStatus(text(payload.id), "sponsorship-request", payload.status);
  }

  const host = isAdmin(claims) ? await resolveHostFromPayload(payload) : await resolveStoreHostByEmail(claims.email);
  if (!host) {
    return json({ error: "No storefront found for this account." }, { status: 404 });
  }

  const record = {
    id: makeId("market_sponsorship_request"),
    type: "market-directory",
    endpoint: "sponsorship-request",
    title: host.business_name,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: { ...payload, business_name: host.business_name, email: host.email, storefront_key: host.key }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await sendEmail(adminMarketDirectoryEmail(record));
  return json({ ok: true, id: record.id });
}

async function handlePostStorefrontStatus(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  const admin = isAdmin(claims);
  const host = (await resolveHostFromPayload(payload)) || (!admin ? await resolveStoreHostByEmail(claims.email) : null);
  if (!host) {
    return json({ error: "Storefront not found." }, { status: 404 });
  }

  const isSelf = claims.role === "store-host" && claims.email === host.email;
  if (!admin && !isSelf) {
    return json({ error: "Not authorized for this action." }, { status: 403 });
  }

  const update = {};
  const allowedFields = admin ? [...hostSelfEditableFields, ...hostAdminOnlyFields, "status"] : hostSelfEditableFields;

  for (const field of allowedFields) {
    if (hasOwn(payload, field)) {
      update[field] = payload[field];
    }
  }

  if (hasOwn(payload, "status") && !admin) {
    if (!hostSelfAllowedStatus.has(payload.status)) {
      return json({ error: "Not authorized to set that status." }, { status: 403 });
    }
    update.status = payload.status;
  }

  const record = {
    id: makeId("market_storefront_status"),
    type: "market-directory",
    endpoint: "storefront-status",
    title: host.business_name,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: { business_name: host.business_name, email: host.email, ...update }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await sendEmail(adminMarketDirectoryEmail(record));
  return json({ ok: true, id: record.id });
}

async function handlePostBillingReceipt(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req, "store-host");
  if (unauthorized) return unauthorized;

  const transactionId = text(payload.transaction_id);
  if (!transactionId) {
    return json({ error: "transaction_id is required." }, { status: 400 });
  }

  const verification = await verifyAppStoreTransaction(transactionId);
  if (!verification.verified) {
    return json({ error: verification.reason || "Could not verify this purchase with Apple." }, { status: 402 });
  }

  const productId = verification.transaction.productId;
  const effect = productEffects[productId];
  if (!effect) {
    return json({ error: `Unrecognized product identifier: ${productId}` }, { status: 422 });
  }

  const firstClaim = await claimTransactionOnce(transactionId);
  if (!firstClaim) {
    return json({ error: "This purchase has already been applied." }, { status: 409 });
  }

  const host = await resolveStoreHostByEmail(claims.email);
  if (!host) {
    return json({ error: "No storefront found for this account." }, { status: 404 });
  }

  const update = effect.delta
    ? { edit_request_credits: (host.edit_request_credits || 0) + effect.delta }
    : { [effect.field]: effect.value };

  const now = new Date().toISOString();
  const statusRecord = {
    id: makeId("market_storefront_status"),
    type: "market-directory",
    endpoint: "storefront-status",
    title: host.business_name,
    status: "new",
    createdAt: now,
    payload: { business_name: host.business_name, email: host.email, ...update, last_purchase_note: `Verified purchase ${productId} (txn ${transactionId})` }
  };
  await marketDirectoryStore().setJSON(statusRecord.id, statusRecord);

  const receiptRecord = {
    id: makeId("market_billing_receipt"),
    type: "market-directory",
    endpoint: "billing-receipt",
    title: host.business_name,
    status: "applied",
    createdAt: now,
    payload: { business_name: host.business_name, email: host.email, product_id: productId, transaction_id: transactionId }
  };
  await marketDirectoryStore().setJSON(receiptRecord.id, receiptRecord);
  await sendEmail(adminMarketDirectoryEmail(receiptRecord));

  return json({ ok: true, id: receiptRecord.id, applied: update });
}

async function handlePostUpvote(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req, "consumer");
  if (unauthorized) return unauthorized;

  const host = await resolveHostFromPayload(payload);
  if (!host) {
    return json({ error: "Storefront not found." }, { status: 404 });
  }

  const record = {
    id: makeId("market_storefront_upvote"),
    type: "market-directory",
    endpoint: "storefront-upvote",
    title: host.business_name,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: {
      storefront_key: host.key,
      business_name: host.business_name,
      consumer_email: claims.email,
      upvoted: !hasOwn(payload, "upvoted") || bool(payload.upvoted)
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  const { count, upvotedByMe } = await upvoteState(host.key, claims.email);
  return json({ ok: true, count, upvoted_by_me: upvotedByMe });
}

async function handlePostReview(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req, "consumer");
  if (unauthorized) return unauthorized;

  const host = await resolveHostFromPayload(payload);
  if (!host) {
    return json({ error: "Storefront not found." }, { status: 404 });
  }

  const rating = int(payload.rating, 0);
  if (rating < 1 || rating > 5) {
    return json({ error: "Rating must be between 1 and 5." }, { status: 400 });
  }

  const consumer = await resolveConsumerByEmail(claims.email);

  const record = {
    id: makeId("market_storefront_review"),
    type: "market-directory",
    endpoint: "storefront-review",
    title: host.business_name,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: {
      storefront_key: host.key,
      business_name: host.business_name,
      rating,
      body: text(payload.body),
      reviewer_name: (consumer && text(consumer.first_name)) || "A shopper",
      purchased: bool(payload.purchased),
      email: claims.email
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  await sendEmail(adminMarketDirectoryEmail(record));
  return json({ ok: true, id: record.id });
}

async function handlePostProduct(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req, "store-host");
  if (unauthorized) return unauthorized;

  if (text(payload.product_id)) {
    const ownerKey = await resolveProductOwnerKey(text(payload.product_id));
    const host = await resolveStoreHostByEmail(claims.email);
    if (!ownerKey || (!isAdmin(claims) && (!host || host.key !== ownerKey))) {
      return json({ error: "Product not found." }, { status: 404 });
    }

    const record = {
      id: makeId("market_product"),
      type: "market-directory",
      endpoint: "product",
      title: `Remove product ${payload.product_id}`,
      status: "removed",
      createdAt: new Date().toISOString(),
      payload: { product_id: text(payload.product_id), action: "remove" }
    };
    await marketDirectoryStore().setJSON(record.id, record);
    return json({ ok: true, id: record.id });
  }

  const name = text(payload.name);
  if (!name) {
    return json({ error: "Product name is required." }, { status: 400 });
  }

  const host = isAdmin(claims) && text(payload.storefront_key)
    ? await resolveStoreHostByKey(text(payload.storefront_key))
    : await resolveStoreHostByEmail(claims.email);

  if (!host) {
    return json({ error: "No storefront found for this account." }, { status: 404 });
  }

  const record = {
    id: makeId("market_product"),
    type: "market-directory",
    endpoint: "product",
    title: name,
    status: "new",
    createdAt: new Date().toISOString(),
    payload: {
      storefront_key: host.key,
      business_name: host.business_name,
      name,
      description: text(payload.description),
      price: text(payload.price),
      category: text(payload.category),
      photo_urls: Array.isArray(payload.photo_urls) ? payload.photo_urls.filter((url) => typeof url === "string").slice(0, 10) : []
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  return json({ ok: true, id: record.id, product: { id: record.id, ...record.payload, created_at: record.createdAt } });
}

async function handlePostMessage(req, payload) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  let consumerEmail;
  let hostKey;

  if (text(payload.conversation_id)) {
    const match = text(payload.conversation_id).match(/^conv:(.+)::(.+)$/);
    if (!match) return json({ error: "Invalid conversation." }, { status: 400 });
    [, consumerEmail, hostKey] = match;

    const myHostKey = claims.role === "store-host" ? (await resolveStoreHostByEmail(claims.email))?.key : null;
    const isParticipant = claims.role === "admin"
      || (claims.role === "consumer" && claims.email === consumerEmail)
      || (claims.role === "store-host" && myHostKey === hostKey);

    if (!isParticipant) {
      return json({ error: "Not authorized for this conversation." }, { status: 403 });
    }
  } else {
    if (claims.role !== "consumer" && claims.role !== "admin") {
      return json({ error: "Only a consumer can start a new conversation." }, { status: 403 });
    }
    const host = await resolveHostFromPayload(payload);
    if (!host) return json({ error: "Storefront not found." }, { status: 404 });

    consumerEmail = claims.role === "admin" ? text(payload.email).toLowerCase() : claims.email;
    if (!consumerEmail) return json({ error: "email is required to start a conversation as admin." }, { status: 400 });
    hostKey = host.key;
  }

  const body = text(payload.body);
  if (!body) {
    return json({ error: "Message body is required." }, { status: 400 });
  }

  const record = {
    id: makeId("market_message"),
    type: "market-directory",
    endpoint: "message",
    title: body.slice(0, 80),
    status: "new",
    createdAt: new Date().toISOString(),
    payload: {
      conversation_id: conversationId(consumerEmail, hostKey),
      consumer_email: consumerEmail,
      storefront_key: hostKey,
      sender_role: claims.role,
      sender_email: claims.email,
      body
    }
  };

  await marketDirectoryStore().setJSON(record.id, record);
  return json({ ok: true, id: record.id, conversation_id: record.payload.conversation_id });
}

async function handlePostAccountDelete(req) {
  const { claims, unauthorized } = await requireAppAuth(req);
  if (unauthorized) return unauthorized;

  const now = new Date().toISOString();

  if (claims.role === "consumer") {
    const record = {
      id: makeId("market_consumer_deletion"),
      type: "market-directory",
      endpoint: "consumer-deletion",
      title: claims.email,
      status: "deleted",
      createdAt: now,
      payload: { email: claims.email }
    };
    await marketDirectoryStore().setJSON(record.id, record);
    await sendEmail(adminMarketDirectoryEmail(record));
    return json({ ok: true });
  }

  if (claims.role === "store-host") {
    const host = await resolveStoreHostByEmail(claims.email);
    if (!host) {
      return json({ error: "No storefront found for this account." }, { status: 404 });
    }

    const record = {
      id: makeId("market_storefront_status"),
      type: "market-directory",
      endpoint: "storefront-status",
      title: host.business_name,
      status: "new",
      createdAt: now,
      payload: { business_name: host.business_name, email: host.email, status: "Scheduled for Deletion" }
    };
    await marketDirectoryStore().setJSON(record.id, record);
    await sendEmail(adminMarketDirectoryEmail(record));
    return json({ ok: true });
  }

  return json({ error: "Admin accounts cannot be deleted through this endpoint." }, { status: 403 });
}

// ---------- Dispatch ----------

export default async (req) => {
  const endpoint = endpointFromRequest(req);

  if (!allowedEndpoints.has(endpoint)) {
    return json({ error: "Unknown Market Directory endpoint" }, { status: 404 });
  }

  if (req.method === "GET") {
    switch (endpoint) {
      case "store-hosts": return handleGetStoreHosts(req);
      case "consumers": return handleGetConsumers(req);
      case "product": return handleGetProduct(req);
      case "storefront-review": return handleGetReviews(req);
      case "storefront-upvote": return handleGetUpvoteState(req);
      case "message": return handleGetMessages(req);
      case "support-request": return handleGetRequests(req, "support-request");
      case "host-access-request": return handleGetRequests(req, "host-access-request");
      case "sponsorship-request": return handleGetRequests(req, "sponsorship-request");
      default: return json({ error: "Method not allowed" }, { status: 405 });
    }
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await readJSON(req);

  switch (endpoint) {
    case "consumer-signup": return handleConsumerProfileUpdate(req, payload);
    case "store-host-signup": return handleStoreHostSignup(payload);
    case "host-access-request": return handlePostHostAccessRequest(req, payload);
    case "support-request": return handlePostSupportRequest(req, payload);
    case "sponsorship-request": return handlePostSponsorshipRequest(req, payload);
    case "storefront-status": return handlePostStorefrontStatus(req, payload);
    case "billing-receipt": return handlePostBillingReceipt(req, payload);
    case "storefront-upvote": return handlePostUpvote(req, payload);
    case "storefront-review": return handlePostReview(req, payload);
    case "product": return handlePostProduct(req, payload);
    case "message": return handlePostMessage(req, payload);
    case "account-delete": return handlePostAccountDelete(req);
    default: return json({ error: "Unknown Market Directory endpoint" }, { status: 404 });
  }
};

export const config = {
  path: "/api/market-directory/:endpoint"
};
