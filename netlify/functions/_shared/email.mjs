const adminEmail = "gilbert.aguirre.office@gmail.com";

function env(name) {
  return Netlify.env.get(name);
}

export async function sendEmail({ to, cc, bcc, subject, text, attachments }) {
  const resendKey = env("RESEND_API_KEY");
  const from = env("FROM_EMAIL") || "American Dev Corp <noreply@americandevcorp.com>";

  if (!resendKey) {
    console.log("Email skipped; RESEND_API_KEY is not configured.", { to, subject });
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
      ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
      subject,
      text,
      ...(attachments ? { attachments } : {})
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider failed: ${response.status} ${detail}`);
  }

  return { sent: true };
}

export function adminRequestEmail(record) {
  return {
    to: adminEmail,
    subject: `New iOS submission service request: ${record.appName || "Untitled app"}`,
    text: [
      "A new iOS App Submission Service request was submitted.",
      "",
      `Request ID: ${record.id}`,
      `Submitted: ${record.createdAt}`,
      "",
      ...Object.entries(record.fields || {}).map(([key, value]) => `${key}: ${value}`)
    ].join("\n")
  };
}

export function adminApplicationEmail(record) {
  return {
    to: adminEmail,
    subject: `New authorized app intake: ${record.appName || "Untitled app"}`,
    text: [
      "A new authorized App Store application intake was submitted.",
      "",
      `Application ID: ${record.id}`,
      `Request ID: ${record.requestId}`,
      `Submitted: ${record.createdAt}`,
      "",
      ...Object.entries(record.fields || {}).map(([key, value]) => `${key}: ${value}`)
    ].join("\n")
  };
}

export function adminMarketDirectoryEmail(record) {
  const readableType = String(record.endpoint || "market-directory").replaceAll("-", " ");

  return {
    to: adminEmail,
    subject: `The Market Directory ${readableType}: ${record.title || record.id}`,
    text: [
      "A new The Market Directory event was submitted.",
      "",
      `Record ID: ${record.id}`,
      `Type: ${record.endpoint}`,
      `Submitted: ${record.createdAt}`,
      "",
      ...Object.entries(record.payload || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    ].join("\n")
  };
}

export function marketDirectoryStorefrontEnrollmentEmail(record) {
  const payload = record.payload || {};
  const ownerName = payload.owner_name || "there";
  const businessName = payload.business_name || "your business";
  const steps = Array.isArray(payload.enrollment_steps) && payload.enrollment_steps.length
    ? payload.enrollment_steps
    : [
      "Contact: You connected with your local ADC representative.",
      "Enroll: We collected the basic details needed to create your business draft.",
      "We Build: ADC researches and builds your storefront draft for review.",
      "Preview: We send you a complete draft so you can suggest changes.",
      "Approve: Your approval is all we need for the final version.",
      "Publish: Your storefront goes live on The Market Directory."
    ];
  const businessLines = [
    `Business: ${businessName}`,
    `Category: ${payload.category_name || "Not provided"}`,
    `Location: ${[payload.city, payload.state].filter(Boolean).join(", ") || "Not provided"}`,
    `Phone: ${payload.phone || "Not provided"}`,
    `Website: ${payload.website || "Not provided"}`,
    `Hours: ${payload.hours || "Not provided"}`
  ];

  return {
    to: payload.to_email || payload.owner_email,
    cc: payload.cc_email || undefined,
    bcc: payload.bcc_email || payload.admin_copy_email || undefined,
    subject: payload.subject || "Your Market Directory enrollment is started",
    text: payload.message || [
      `Hi ${ownerName},`,
      "",
      `Thank you for enrolling ${businessName} in The Market Directory.`,
      "",
      "We created a non-public draft storefront from the details you shared. Our next step is to complete the storefront draft, add available business information, prepare products or services where applicable, and send you a preview for approval before anything is published.",
      "",
      "What happens next:",
      ...steps.map((step) => `- ${step}`),
      "",
      "Business on file:",
      ...businessLines,
      "",
      "Your part is easy: review the preview when we send it and let us know what should change. We take care of the setup work.",
      "",
      "American Dev Corp",
      "The Market Directory"
    ].join("\n")
  };
}

export function marketDirectoryProductDecisionEmail(record) {
  const payload = record.payload || {};
  const status = String(payload.status || "").toLowerCase();
  const approved = status === "listed";
  const productTitle = payload.product_title || "your product";
  const storefrontName = payload.storefront_name || "your storefront";
  const reviewNote = payload.review_note || (approved
    ? "Approved for public listing."
    : "Your product needs an update before it can go live.");

  return {
    to: payload.store_host_email,
    subject: approved
      ? `The Market Directory product approved: ${productTitle}`
      : `The Market Directory product needs changes: ${productTitle}`,
    text: [
      `Hello ${payload.owner_name || "Store Host"},`,
      "",
      `Product: ${productTitle}`,
      `Storefront: ${storefrontName}`,
      `Decision: ${approved ? "Approved for public listing" : "Rejected for changes"}`,
      "",
      `Review note: ${reviewNote}`,
      "",
      approved
        ? "Your product is now eligible to appear in The Market Directory when your storefront is public/listed."
        : "Please update the product details in your Store Host dashboard and resubmit it for review.",
      "",
      "American Dev Corp"
    ].join("\n")
  };
}

export function approvalEmail({ name, appName, code }) {
  return {
    subject: `American Dev Corp approval for ${appName || "your iOS app"}`,
    text: [
      `Hello ${name || "there"},`,
      "",
      "Thank you for requesting iOS App Submission Service support from American Dev Corp.",
      "",
      "Your request has been approved to move into the detailed application intake stage. Use the access code below on the iOS App Submission Service page to open the full application intake form.",
      "",
      `Access code: ${code}`,
      "",
      "This code is tied to the email address used in your original request. Please complete the detailed intake with accurate App Store Connect, build, policy, and review information so the submission can be evaluated properly.",
      "",
      "American Dev Corp"
    ].join("\n")
  };
}

export function denialEmail({ name, appName }) {
  return {
    subject: `American Dev Corp update for ${appName || "your iOS app request"}`,
    text: [
      `Hello ${name || "there"},`,
      "",
      "Thank you for reaching out to American Dev Corp for iOS App Submission Service support.",
      "",
      "After reviewing the information provided, this request is not ready to move forward into the detailed App Store submission intake stage at this time. This may be due to missing project readiness, unclear submission requirements, account access limitations, or the need for additional preparation before publication support would be effective.",
      "",
      "You are welcome to refine the app concept, prepare additional materials, and submit a new request when the project is closer to review readiness.",
      "",
      "American Dev Corp"
    ].join("\n")
  };
}
