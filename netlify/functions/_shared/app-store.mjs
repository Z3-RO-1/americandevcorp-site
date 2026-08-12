import { AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import { marketDirectoryStore } from "./storage.mjs";

const bundleId = "american-dev-corp.The-Market-Directory";
const appleRootCertURL = "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer";

let cachedRootCert = null;

function env(name) {
  return Netlify.env.get(name);
}

function hasCredentials() {
  return Boolean(env("APP_STORE_CONNECT_ISSUER_ID") && env("APP_STORE_CONNECT_KEY_ID") && env("APP_STORE_CONNECT_PRIVATE_KEY_BASE64"));
}

function signingKey() {
  return Buffer.from(env("APP_STORE_CONNECT_PRIVATE_KEY_BASE64"), "base64").toString("utf8");
}

async function loadAppleRootCertificate() {
  if (cachedRootCert) {
    return cachedRootCert;
  }

  const response = await fetch(appleRootCertURL);
  if (!response.ok) {
    throw new Error(`Could not fetch Apple's root certificate (${response.status}).`);
  }

  cachedRootCert = Buffer.from(await response.arrayBuffer());
  return cachedRootCert;
}

async function verifyInEnvironment(transactionId, environment) {
  const client = new AppStoreServerAPIClient(
    signingKey(),
    env("APP_STORE_CONNECT_KEY_ID"),
    env("APP_STORE_CONNECT_ISSUER_ID"),
    bundleId,
    environment
  );

  const { signedTransactionInfo } = await client.getTransactionInfo(transactionId);
  const rootCert = await loadAppleRootCertificate();
  const verifier = new SignedDataVerifier([rootCert], true, environment, bundleId);
  return verifier.verifyAndDecodeTransaction(signedTransactionInfo);
}

// Verifies a transaction id against Apple's servers (not just the on-device StoreKit2 check,
// which only proves the transaction was signed by Apple *to the device* — this proves the
// transaction is real, current, and unrevoked as of right now). Tries production first, then
// falls back to sandbox for TestFlight/sandbox purchases, which Apple's production endpoint
// rejects with a distinct "sandbox receipt used in production" error.
export async function verifyAppStoreTransaction(transactionId) {
  if (!hasCredentials()) {
    return { verified: false, reason: "App Store Connect API credentials are not configured on the server." };
  }

  try {
    const transaction = await verifyInEnvironment(transactionId, Environment.PRODUCTION);
    return { verified: true, transaction };
  } catch (productionError) {
    try {
      const transaction = await verifyInEnvironment(transactionId, Environment.SANDBOX);
      return { verified: true, transaction };
    } catch (sandboxError) {
      return {
        verified: false,
        reason: `Apple could not verify this transaction (production: ${productionError.message || productionError}; sandbox: ${sandboxError.message || sandboxError}).`
      };
    }
  }
}

// Blocks replaying a previously-applied, still-valid receipt to double-grant its effect —
// critical for the consumable "edit request credit" product, which increments a counter
// rather than just flipping a boolean a second application would leave unchanged.
export async function claimTransactionOnce(transactionId) {
  const store = marketDirectoryStore();
  const key = `billing_txn_${transactionId}`;

  const existing = await store.get(key, { type: "json" });
  if (existing) {
    return false;
  }

  await store.setJSON(key, { transactionId, claimedAt: new Date().toISOString() });
  return true;
}
