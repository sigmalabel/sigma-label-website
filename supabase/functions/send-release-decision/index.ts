// Supabase Edge Function: send-release-decision
// Deploy with: supabase functions deploy send-release-decision
// Required secrets:
//   RESEND_API_KEY=...
//   SUPABASE_SERVICE_ROLE_KEY=...
// Optional:
//   SIGMA_FROM_EMAIL="Sigma Label LLC <noreply@sigmalabel.xyz>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ADMIN_EMAILS = new Set([
  "sigmalabelllc@gmail.com",
  "inquiries.djsxd@gmail.com",
  "thesamuraiiikun@protonmail.com",
  "enderprice2@gmail.com",
  "heatitprod@gmail.com",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function emailBody(decision: string, artistName: string, releaseTitle: string) {
  const accepted = decision === "accepted";
  const subject = accepted
    ? `Sigma Label LLC - ${releaseTitle} has been accepted`
    : `Sigma Label LLC - ${releaseTitle} submission update`;

  const html = accepted
    ? `
      <p>Hi ${artistName},</p>
      <p>Thank you for submitting <strong>${releaseTitle}</strong> to Sigma Label LLC.</p>
      <p>We reviewed the submission and are happy to let you know that the release has been <strong>accepted</strong>.</p>
      <p>Our team will continue with the next release steps and will contact you if we need any additional files, cover art, metadata, or contributor information.</p>
      <p>Best regards,<br/>Sigma Label LLC</p>`
    : `
      <p>Hi ${artistName},</p>
      <p>Thank you for submitting <strong>${releaseTitle}</strong> to Sigma Label LLC.</p>
      <p>After reviewing the submission, we decided that we will not move forward with this release at this time.</p>
      <p>We appreciate you sending your music and wish you the best with the track.</p>
      <p>Best regards,<br/>Sigma Label LLC</p>`;

  const text = accepted
    ? `Hi ${artistName},\n\nThank you for submitting ${releaseTitle} to Sigma Label LLC.\n\nWe reviewed the submission and are happy to let you know that the release has been accepted.\n\nOur team will continue with the next release steps and will contact you if we need any additional files, cover art, metadata, or contributor information.\n\nBest regards,\nSigma Label LLC`
    : `Hi ${artistName},\n\nThank you for submitting ${releaseTitle} to Sigma Label LLC.\n\nAfter reviewing the submission, we decided that we will not move forward with this release at this time.\n\nWe appreciate you sending your music and wish you the best with the track.\n\nBest regards,\nSigma Label LLC`;

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
  const fromEmail = Deno.env.get("SIGMA_FROM_EMAIL") || "Sigma Label LLC <noreply@sigmalabel.xyz>";

  if (!serviceRoleKey || !resendApiKey) {
    return json({ error: "Server secrets are not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user?.email || !ALLOWED_ADMIN_EMAILS.has(userData.user.email.toLowerCase())) {
    return json({ error: "Not authorized." }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const decision = body.decision === "accepted" ? "accepted" : body.decision === "rejected" ? "rejected" : null;
  const recipientEmail = String(body.recipient_email || "").trim();
  const artistName = String(body.artist_name || "artist").trim();
  const releaseTitle = String(body.release_title || "your release").trim();

  if (!decision || !recipientEmail.includes("@")) {
    return json({ error: "Missing decision or recipient email." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  if (body.submission_id) {
    const { data: submission, error } = await adminClient
      .from("submissions")
      .select("id, contact_email, release_title, primary_artist")
      .eq("id", body.submission_id)
      .maybeSingle();
    if (error || !submission) return json({ error: "Submission was not found." }, 404);
  }

  const content = emailBody(decision, artistName, releaseTitle);
  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipientEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  const resendBody = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return json({ error: resendBody?.message || "Email provider failed." }, 502);
  }

  return json({ ok: true, provider: resendBody });
});
