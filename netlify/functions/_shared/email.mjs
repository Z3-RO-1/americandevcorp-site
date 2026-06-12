const adminEmail = "gilbert.aguirre.office@gmail.com";

function env(name) {
  return Netlify.env.get(name);
}

export async function sendEmail({ to, subject, text }) {
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
      subject,
      text
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
