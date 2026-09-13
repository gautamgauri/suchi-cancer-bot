#!/usr/bin/env ts-node
/**
 * LinkedIn OAuth helper for SCCF organisation-page posting (issue #27).
 *
 * The Suchi API posts to the SCCF LinkedIn page with a member access token that
 * carries `w_organization_social`. LinkedIn issues those tokens only through the
 * browser-based 3-legged flow, and they expire after 60 days. Non–Marketing
 * Developer Platform apps get no refresh token, so a human has to re-run this
 * roughly every two months. Full runbook: docs/LINKEDIN_ORG_POSTING.md
 *
 * Usage (from the repo root):
 *
 *   # 1. print the authorisation URL to open in a browser
 *   LINKEDIN_CLIENT_ID=xxx ts-node scripts/linkedin-oauth-exchange.ts url
 *
 *   # 2. paste the ?code=... from the redirect back here
 *   LINKEDIN_CLIENT_ID=xxx LINKEDIN_CLIENT_SECRET=yyy \
 *     ts-node scripts/linkedin-oauth-exchange.ts exchange --code AQT...
 *
 *   # 3. list the organisation pages this token may post for (needs
 *   #    r_organization_social) and print the LINKEDIN_AUTHOR_URN to use
 *   LINKEDIN_ACCESS_TOKEN=... ts-node scripts/linkedin-oauth-exchange.ts orgs
 *
 * No secret is ever written to the repo — the token is printed once, for you to
 * pipe straight into `gcloud secrets versions add`.
 */

const AUTH_URL     = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL    = "https://www.linkedin.com/oauth/v2/accessToken";
const REST_BASE    = "https://api.linkedin.com/rest";
const API_VERSION  = process.env.LINKEDIN_API_VERSION ?? "202608";

// w_organization_social is what the posting path needs. r_organization_social is
// only needed for the `orgs` lookup below (and to read back your own posts).
const SCOPES = process.env.LINKEDIN_SCOPES ?? "w_organization_social r_organization_social";

// Must match a redirect URL registered on the LinkedIn app exactly.
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI ?? "https://suchicancercare.org/oauth/linkedin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See docs/LINKEDIN_ORG_POSTING.md`);
    process.exit(1);
  }
  return v;
}

function printUrl(): void {
  const clientId = requireEnv("LINKEDIN_CLIENT_ID");
  const state = arg("state") ?? `suchi-${Date.now()}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPES,
  }).toString()}`;
  console.log("\nOpen this URL in a browser, signed in as a LinkedIn member who is an");
  console.log("ADMINISTRATOR (or CONTENT_ADMIN) of the SCCF page:\n");
  console.log(url);
  console.log(`\nAfter you approve, the browser lands on ${REDIRECT_URI}?code=...&state=${state}`);
  console.log("(the page may 404 — that is fine, you only need the `code` query param).");
  console.log("The code is valid for 30 minutes. Then run:\n");
  console.log("  ts-node scripts/linkedin-oauth-exchange.ts exchange --code <code>\n");
}

async function exchange(): Promise<void> {
  const code = arg("code");
  if (!code) {
    console.error("Usage: exchange --code <authorization code>");
    process.exit(1);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: requireEnv("LINKEDIN_CLIENT_ID"),
      client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const data = await res.json() as {
    access_token?: string; expires_in?: number; scope?: string;
    refresh_token?: string; refresh_token_expires_in?: number;
    error?: string; error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    console.error(`Token exchange failed (HTTP ${res.status}): ${data.error ?? ""} ${data.error_description ?? ""}`);
    console.error("Common causes: the code was already used or is over 30 minutes old, or");
    console.error("redirect_uri does not byte-match the one registered on the LinkedIn app.");
    process.exit(1);
  }

  const days = Math.round((data.expires_in ?? 0) / 86400);
  const expiresOn = new Date(Date.now() + (data.expires_in ?? 0) * 1000).toISOString().slice(0, 10);
  console.log(`\nGranted scopes : ${data.scope ?? "(not reported)"}`);
  console.log(`Access token   : expires in ${days} days, on ${expiresOn}`);
  if (data.refresh_token) {
    const rDays = Math.round((data.refresh_token_expires_in ?? 0) / 86400);
    console.log(`Refresh token  : returned (valid ${rDays} days) — this app IS refresh-eligible.`);
  } else {
    console.log("Refresh token  : NOT returned — re-run this flow by hand before the expiry above.");
  }
  console.log("\nStore it (the value is printed once, below, and nowhere else):\n");
  console.log("  printf %s '<paste token>' | gcloud secrets versions add linkedin-access-token --data-file=- \\");
  console.log("    --project=gen-lang-client-0202543132\n");
  console.log(data.access_token);
  if (data.refresh_token) console.log(`\nrefresh_token: ${data.refresh_token}`);
  console.log("\nSet a calendar reminder for 55 days from today, then run `orgs` below.\n");
}

async function orgs(): Promise<void> {
  const token = requireEnv("LINKEDIN_ACCESS_TOKEN");
  const url = `${REST_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": API_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`organizationAcls failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
    if (res.status === 403) {
      console.error("The token lacks r_organization_social, or the member is not a page admin.");
      console.error("You can skip this call: read the org id off the page's admin URL instead");
      console.error("(https://www.linkedin.com/company/<id>/admin/) — see docs/LINKEDIN_ORG_POSTING.md");
    }
    process.exit(1);
  }
  const data = JSON.parse(text) as { elements?: Array<{ organization?: string; role?: string; state?: string }> };
  const elements = data.elements ?? [];
  if (elements.length === 0) {
    console.log("No approved organisation admin roles for this member.");
    return;
  }
  console.log("\nOrganisation pages this token can post for:\n");
  for (const e of elements) console.log(`  ${e.organization}   (role ${e.role}, ${e.state})`);
  console.log("\nUse the SCCF one verbatim as LINKEDIN_AUTHOR_URN:\n");
  console.log("  printf %s '<urn:li:organization:...>' | gcloud secrets versions add linkedin-author-urn \\");
  console.log("    --data-file=- --project=gen-lang-client-0202543132\n");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "url") return printUrl();
  if (cmd === "exchange") return exchange();
  if (cmd === "orgs") return orgs();
  console.error("Usage: linkedin-oauth-exchange.ts <url|exchange --code <code>|orgs>");
  console.error("See docs/LINKEDIN_ORG_POSTING.md");
  process.exit(1);
}

void main();
