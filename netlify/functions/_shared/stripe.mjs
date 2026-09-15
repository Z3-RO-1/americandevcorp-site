import Stripe from "stripe";

function env(name) {
  return Netlify.env.get(name);
}

// The Market Directory's self-service Tap to Pay billing:
// - A single recurring monthly listing price, looked up/created idempotently by lookup_key.
// - A single Terminal Location representing the admin's Tap to Pay device fleet, looked up/created by display_name.
// Both are created automatically on first use so no manual Stripe Dashboard setup is required.
const listingPriceLookupKey = "market-directory-listing-monthly";
const listingPriceAmountCents = 499;
const listingProductName = "The Market Directory - Business Listing (Monthly)";
const terminalLocationDisplayName = "The Market Directory - Tap to Pay";

let cachedClient = null;

export function stripeClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured on this Netlify site.");
  }

  cachedClient = new Stripe(secretKey);
  return cachedClient;
}

// Idempotent: looks up the $4.99/month listing Price by a fixed lookup_key, creating the
// Product + Price only the first time this ever runs. No manual Dashboard setup required.
export async function getOrCreateListingPrice() {
  const stripe = stripeClient();

  const existing = await stripe.prices.list({
    lookup_keys: [listingPriceLookupKey],
    active: true,
    limit: 1
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  const product = await stripe.products.create({
    name: listingProductName
  });

  return stripe.prices.create({
    unit_amount: listingPriceAmountCents,
    currency: "usd",
    recurring: { interval: "month" },
    product: product.id,
    lookup_key: listingPriceLookupKey
  });
}

// Idempotent: Tap to Pay readers must be associated with a Terminal Location at connection time.
// Locations have no lookup_key concept, so this matches on display_name instead.
export async function getOrCreateTerminalLocation() {
  const stripe = stripeClient();

  const existing = await stripe.terminal.locations.list({ limit: 100 });
  const match = existing.data.find((location) => location.display_name === terminalLocationDisplayName);
  if (match) {
    return match;
  }

  return stripe.terminal.locations.create({
    display_name: terminalLocationDisplayName,
    address: { country: "US" }
  });
}

// Finds an existing Stripe Customer for this business by email, or creates one.
export async function getOrCreateCustomerForBusiness({ businessName, email }) {
  const stripe = stripeClient();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (normalizedEmail) {
    const existing = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    if (existing.data.length > 0) {
      return existing.data[0];
    }
  }

  return stripe.customers.create({
    name: businessName || undefined,
    email: normalizedEmail || undefined
  });
}
