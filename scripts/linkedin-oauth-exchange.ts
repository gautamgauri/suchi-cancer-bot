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
 *   # 2. paste the ?code=... from the redirect back here, and name a
 *   #    destination for the token — it is never printed by default
 *   LINKEDIN_CLIENT_ID=xxx LINKEDIN_CLIENT_SECRET=yyy \
 *     ts-node scripts/linkedin-oauth-exchange.ts exchange --code AQT... \
 *       --to-secret-manager linkedin-access-token
 *
 *   # 3. list the organisation pages this token may post for (needs
 *   #    r_organization_social) and print the LINKEDIN_AUTHOR_URN to use
 *   ts-node scripts/linkedin-oauth-exchange.ts orgs --token-file ./li-token
 *
 *   # self-check of the pure helpers (no network, no credentials)
 *   ts-node scripts/linkedin-oauth-exchange.ts --self-test
 *
 * SECURITY: this script never writes a token to stdout unless you pass the
 * explicit `--print-token` opt-in. Terminal scrollback, `script`/asciinema
 * recordings, CI logs and shell wrappers all capture stdout; a LinkedIn posting
 * token captured there is a live credential for 60 days.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const AUTH_URL     = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL    = "https://www.linkedin.com/oauth/v2/accessToken";
const REST_BASE    = "https://api.linkedin.com/rest";
const API_VERSION  = process.env.LINKEDIN_API_VERSION ?? "202608";
const GCP_PROJECT  = process.env.GCP_PROJECT ?? "gen-lang-client-0202543132";

// w_organization_social is what the posting path needs. r_organization_social is
// only needed for the `orgs` lookup below (and to read back your own posts).
const SCOPES = process.env.LINKEDIN_SCOPES ?? "w_organization_social r_organization_social";

// Must match a redirect URL registered on the LinkedIn app exactly.
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI ?? "https://suchicancercare.org/oauth/linkedin";

// ---------------------------------------------------------------------------
// Pure helpers (covered by `--self-test`)
// ---------------------------------------------------------------------------

type FlagKind = "value" | "boolean";

export const FLAG_SPEC: Record<string, FlagKind> = {
  code: "value",
  state: "value",
  out: "value",
  "to-secret-manager": "value",
  "secret-project": "value",
  "token-file": "value",
  force: "boolean",
  "print-token": "boolean",
  "self-test": "boolean",
  help: "boolean",
};

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | true>;
  errors: string[];
}

/** Parse `argv` (everything after the script path). Supports `--k v` and `--k=v`. */
export function parseArgs(argv: string[], spec: Record<string, FlagKind> = FLAG_SPEC): ParsedArgs {
  const flags: Record<string, string | true> = {};
  const errors: string[] = [];
  let command = "";

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      if (!command) command = token;
      else errors.push(`Unexpected argument: ${token}`);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    const kind = spec[name];
    if (!kind) {
      errors.push(`Unknown flag: --${name}`);
      continue;
    }
    if (kind === "boolean") {
      if (inline !== undefined && inline !== "true" && inline !== "false") {
        errors.push(`--${name} does not take a value`);
        continue;
      }
      if (inline === "false") continue;
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        errors.push(`--${name} needs a value`);
        continue;
      }
      value = next;
      i++;
    }
    if (value === "") {
      errors.push(`--${name} needs a value`);
      continue;
    }
    flags[name] = value;
  }

  return { command, flags, errors };
}

export type Destination =
  | { kind: "secret-manager"; secret: string; project: string }
  | { kind: "file"; path: string; force: boolean }
  | { kind: "stdout" };

export interface DestinationResult {
  destination?: Destination;
  errors: string[];
}

/**
 * Exactly one token destination must be chosen, explicitly. There is no
 * implicit default: a helper that prints credentials when you forget a flag is
 * the bug this function exists to prevent.
 */
export function resolveDestination(
  flags: Record<string, string | true>,
  defaultProject = GCP_PROJECT,
): DestinationResult {
  const chosen: Destination[] = [];
  const secret = flags["to-secret-manager"];
  const out = flags["out"];

  if (typeof secret === "string") {
    const project = typeof flags["secret-project"] === "string" ? flags["secret-project"] : defaultProject;
    chosen.push({ kind: "secret-manager", secret, project });
  }
  if (typeof out === "string") {
    chosen.push({ kind: "file", path: out, force: flags["force"] === true });
  }
  if (flags["print-token"] === true) chosen.push({ kind: "stdout" });

  if (chosen.length === 0) {
    return {
      errors: [
        "No token destination given. Choose exactly one:",
        "  --to-secret-manager <secret-name>  pipe the token into `gcloud secrets versions add` (recommended)",
        "  --out <path>                       write it to a new file created with mode 0600",
        "  --print-token                      print it to stdout (captured by scrollback and logs)",
      ],
    };
  }
  if (chosen.length > 1) {
    return { errors: ["Choose only one of --to-secret-manager, --out and --print-token."] };
  }
  return { destination: chosen[0], errors: [] };
}

export interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Human-readable summary of an exchange result. Deliberately reports only
 * metadata — length, expiry, scopes, refresh-token presence — never a value.
 */
export function summarizeToken(data: TokenResponse, nowMs: number): string[] {
  const expiresIn = data.expires_in ?? 0;
  const days = Math.round(expiresIn / 86400);
  const expiresOn = new Date(nowMs + expiresIn * 1000).toISOString().slice(0, 10);
  const lines = [
    `Granted scopes : ${data.scope ?? "(not reported)"}`,
    `Access token   : ${(data.access_token ?? "").length} characters, expires in ${days} days, on ${expiresOn}`,
  ];
  if (data.refresh_token) {
    const rDays = Math.round((data.refresh_token_expires_in ?? 0) / 86400);
    lines.push(
      `Refresh token  : returned (${data.refresh_token.length} characters, valid ${rDays} days) — this app IS refresh-eligible.`,
    );
  } else {
    lines.push("Refresh token  : NOT returned — re-run this flow by hand before the expiry above.");
  }
  return lines;
}

/**
 * Scrub credential values out of anything echoed back from the API or gcloud.
 * Short values are left alone: redacting them would mangle unrelated text
 * without protecting anything worth protecting.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined>, minLength = 8): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < minLength) continue;
    out = out.split(secret).join(`***redacted(${secret.length} chars)***`);
  }
  return out;
}

export interface OrgAcl {
  organization?: string;
  role?: string;
  state?: string;
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): string {
  return `${AUTH_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scopes,
  }).toString()}`;
}

// ---------------------------------------------------------------------------
// Side-effecting helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See docs/LINKEDIN_ORG_POSTING.md`);
    process.exit(1);
  }
  return v;
}

/** Write `value` to `target` with mode 0600, refusing to clobber unless forced. */
export function writeSecretFile(target: string, value: string, force: boolean): void {
  const abs = path.resolve(target);
  let fd: number;
  try {
    // "wx" fails with EEXIST rather than truncating whatever is already there.
    fd = fs.openSync(abs, force ? "w" : "wx", 0o600);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      throw new Error(`${abs} already exists. Pick another --out path, or pass --force to overwrite it.`);
    }
    throw err;
  }
  try {
    // An existing file keeps its old mode when opened with "w"; force it back.
    fs.fchmodSync(fd, 0o600);
    // No trailing newline: a newline inside the secret value produces a
    // malformed Authorization header and a confusing 401.
    fs.writeSync(fd, value);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Pipe `value` into `gcloud secrets versions add <secret> --data-file=-`.
 * The value goes over the child's stdin: it never appears in argv (visible in
 * `ps`), in a shell command line, or in a temp file on disk.
 */
export function addSecretVersion(secret: string, project: string, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "gcloud",
      ["secrets", "versions", "add", secret, "--data-file=-", `--project=${project}`, "--format=value(name)"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", (err) =>
      reject(new Error(`Could not run gcloud (${(err as Error).message}). Is the SDK installed and on PATH?`)),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout.trim() || `${secret} (new version)`);
      reject(new Error(`gcloud exited ${code}: ${redactSecrets(stderr.trim(), [value]).slice(0, 600)}`));
    });
    child.stdin.on("error", () => { /* surfaced by the close handler */ });
    child.stdin.end(value);
  });
}

async function deliver(label: string, value: string, dest: Destination): Promise<void> {
  if (dest.kind === "secret-manager") {
    const version = await addSecretVersion(dest.secret, dest.project, value);
    console.log(`${label}: stored as Secret Manager version ${version}`);
    return;
  }
  if (dest.kind === "file") {
    writeSecretFile(dest.path, value, dest.force);
    console.log(`${label}: written to ${path.resolve(dest.path)} (mode 0600, no trailing newline)`);
    return;
  }
  console.log(`\n!! ${label} follows in cleartext — scrollback, recordings and log`);
  console.log("!! wrappers will capture it. Rotate it if this terminal is shared.\n");
  console.log(value);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function printUrl(parsed: ParsedArgs): void {
  const clientId = requireEnv("LINKEDIN_CLIENT_ID");
  const state = typeof parsed.flags.state === "string" ? parsed.flags.state : `suchi-${Date.now()}`;
  const url = buildAuthUrl({ clientId, redirectUri: REDIRECT_URI, scopes: SCOPES, state });
  console.log("\nOpen this URL in a browser, signed in as a LinkedIn member who is an");
  console.log("ADMINISTRATOR (or CONTENT_ADMIN) of the SCCF page:\n");
  console.log(url);
  console.log(`\nAfter you approve, the browser lands on ${REDIRECT_URI}?code=...&state=${state}`);
  console.log("(the page may 404 — that is fine, you only need the `code` query param).");
  console.log("The code is valid for 30 minutes. Then run:\n");
  console.log("  ts-node scripts/linkedin-oauth-exchange.ts exchange --code <code> \\");
  console.log("    --to-secret-manager linkedin-access-token\n");
}

async function exchange(parsed: ParsedArgs): Promise<void> {
  const code = typeof parsed.flags.code === "string" ? parsed.flags.code : undefined;
  if (!code) {
    console.error("Usage: exchange --code <authorization code> (--to-secret-manager <name> | --out <path> | --print-token)");
    process.exit(1);
  }
  const { destination, errors } = resolveDestination(parsed.flags);
  if (!destination) {
    for (const line of errors) console.error(line);
    process.exit(1);
  }

  const clientSecret = requireEnv("LINKEDIN_CLIENT_SECRET");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: requireEnv("LINKEDIN_CLIENT_ID"),
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    const detail = redactSecrets(`${data.error ?? ""} ${data.error_description ?? ""}`.trim(), [clientSecret, code]);
    console.error(`Token exchange failed (HTTP ${res.status}): ${detail}`);
    console.error("Common causes: the code was already used or is over 30 minutes old, or");
    console.error("redirect_uri does not byte-match the one registered on the LinkedIn app.");
    process.exit(1);
  }

  console.log("");
  for (const line of summarizeToken(data, Date.now())) console.log(line);
  console.log("");

  try {
    await deliver("Access token", data.access_token, destination);
    if (data.refresh_token) {
      await deliver("Refresh token", data.refresh_token, refreshDestination(destination));
    }
  } catch (err) {
    console.error(`\nCould not store the token: ${(err as Error).message}`);
    console.error("The token itself is still valid — re-run with a different destination,");
    console.error("or store it by hand (docs/LINKEDIN_ORG_POSTING.md step 3).");
    process.exit(1);
  }

  console.log("\nNext: `orgs` to confirm the author URN, then deploy (docs/LINKEDIN_ORG_POSTING.md).");
  console.log("Set a calendar reminder for 55 days from today.\n");
}

/** Refresh tokens go to a sibling destination so neither value overwrites the other. */
export function refreshDestination(dest: Destination): Destination {
  if (dest.kind === "secret-manager") {
    return { ...dest, secret: `${dest.secret}-refresh` };
  }
  if (dest.kind === "file") {
    return { ...dest, path: `${dest.path}.refresh` };
  }
  return dest;
}

function readToken(parsed: ParsedArgs): string {
  const file = parsed.flags["token-file"];
  if (typeof file === "string") {
    const value = fs.readFileSync(path.resolve(file), "utf8").trim();
    if (!value) {
      console.error(`${file} is empty.`);
      process.exit(1);
    }
    return value;
  }
  return requireEnv("LINKEDIN_ACCESS_TOKEN");
}

async function orgs(parsed: ParsedArgs): Promise<void> {
  const token = readToken(parsed);
  const url = `${REST_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": API_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) failAcls(res.status, text, token);
  const elements = (JSON.parse(text) as { elements?: OrgAcl[] }).elements ?? [];
  if (elements.length === 0) {
    console.log("No approved organisation admin roles for this member.");
    return;
  }
  console.log("\nOrganisation pages this token can post for:\n");
  for (const e of elements) console.log(`  ${e.organization}   (role ${e.role}, ${e.state})`);
  console.log("\nUse the SCCF one verbatim as LINKEDIN_AUTHOR_URN:\n");
  console.log("  printf %s 'urn:li:organization:<id>' | gcloud secrets versions add linkedin-author-urn \\");
  console.log(`    --data-file=- --project=${GCP_PROJECT}\n`);
}

function failAcls(status: number, body: string, token: string): never {
  console.error(`organizationAcls failed (HTTP ${status}): ${redactSecrets(body, [token]).slice(0, 400)}`);
  if (status === 403) {
    console.error("The token lacks r_organization_social, or the member holds no page role.");
    console.error("You can skip this call: read the org id off the page's admin URL instead");
    console.error("(https://www.linkedin.com/company/<id>/admin/) — see docs/LINKEDIN_ORG_POSTING.md");
  }
  process.exit(1);
}

function usage(): void {
  console.error("Usage:");
  console.error("  linkedin-oauth-exchange.ts url [--state <s>]");
  console.error("  linkedin-oauth-exchange.ts exchange --code <code> \\");
  console.error("      (--to-secret-manager <secret> [--secret-project <id>] | --out <path> [--force] | --print-token)");
  console.error("  linkedin-oauth-exchange.ts orgs [--token-file <path>]");
  console.error("  linkedin-oauth-exchange.ts --self-test");
  console.error("See docs/LINKEDIN_ORG_POSTING.md");
}

// ---------------------------------------------------------------------------
// Self-test — `ts-node scripts/linkedin-oauth-exchange.ts --self-test`
//
// No jest project reaches scripts/ (apps/api/jest.config.js sets
// roots: ["<rootDir>/src"]), so the pure helpers carry their own checks.
// ---------------------------------------------------------------------------

export function selfTest(): number {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) console.log(`  ok   ${name}`);
    else {
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
      failures.push(name);
    }
  };
  // A shape no credential scanner pattern matches, and obviously fake.
  const FAKE_TOKEN = "AQV-fake-access-token-for-self-test-0123456789";
  const FAKE_REFRESH = "AQW-fake-refresh-token-for-self-test-0123456789";

  console.log("parseArgs");
  {
    const p = parseArgs(["exchange", "--code", "AQT123", "--out", "/tmp/x", "--force"]);
    check("command and flags", p.command === "exchange" && p.flags.code === "AQT123" && p.flags.out === "/tmp/x" && p.flags.force === true);
    check("no errors on a valid line", p.errors.length === 0, p.errors.join("; "));
  }
  {
    const p = parseArgs(["exchange", "--code=AQT=456", "--print-token"]);
    check("--k=v form keeps later '=' in the value", p.flags.code === "AQT=456");
    check("boolean flag set", p.flags["print-token"] === true);
  }
  check("unknown flag is an error", parseArgs(["--nope"]).errors.some((e) => e.includes("--nope")));
  check("missing value is an error", parseArgs(["exchange", "--code"]).errors.some((e) => e.includes("--code")));
  check("flag-shaped value is not swallowed", parseArgs(["exchange", "--code", "--out", "/tmp/x"]).errors.length === 1);
  check("boolean flag rejects a value", parseArgs(["--force=yes"]).errors.length === 1);
  check("second positional is an error", parseArgs(["orgs", "extra"]).errors.length === 1);
  check("empty argv yields no command", parseArgs([]).command === "");

  console.log("resolveDestination");
  {
    const none = resolveDestination({});
    check("no destination refuses", none.destination === undefined && none.errors.length > 0);
    check("refusal names all three options", none.errors.join(" ").includes("--to-secret-manager") && none.errors.join(" ").includes("--out") && none.errors.join(" ").includes("--print-token"));
    const both = resolveDestination({ out: "/tmp/x", "print-token": true });
    check("two destinations refuse", both.destination === undefined && both.errors.length === 1);
    const sm = resolveDestination({ "to-secret-manager": "linkedin-access-token" }, "proj-1");
    check("secret-manager destination", sm.destination?.kind === "secret-manager" && (sm.destination as { secret: string }).secret === "linkedin-access-token");
    check("default project applied", (sm.destination as { project: string }).project === "proj-1");
    const smp = resolveDestination({ "to-secret-manager": "s", "secret-project": "proj-2" }, "proj-1");
    check("--secret-project overrides", (smp.destination as { project: string }).project === "proj-2");
    const file = resolveDestination({ out: "/tmp/x" });
    check("file destination defaults to no-force", file.destination?.kind === "file" && (file.destination as { force: boolean }).force === false);
    const forced = resolveDestination({ out: "/tmp/x", force: true });
    check("--force carried", (forced.destination as { force: boolean }).force === true);
    check("--print-token destination", resolveDestination({ "print-token": true }).destination?.kind === "stdout");
  }

  console.log("refreshDestination");
  {
    const sm = refreshDestination({ kind: "secret-manager", secret: "linkedin-access-token", project: "p" });
    check("refresh goes to a sibling secret", sm.kind === "secret-manager" && sm.secret === "linkedin-access-token-refresh");
    const f = refreshDestination({ kind: "file", path: "/tmp/tok", force: false });
    check("refresh goes to a sibling file", f.kind === "file" && f.path === "/tmp/tok.refresh");
  }

  console.log("summarizeToken");
  {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const lines = summarizeToken(
      { access_token: FAKE_TOKEN, expires_in: 5184000, scope: "w_organization_social r_organization_social" },
      now,
    );
    const text = lines.join("\n");
    check("summary never contains the token", !text.includes(FAKE_TOKEN), text);
    check("reports the token length", text.includes(`${FAKE_TOKEN.length} characters`));
    check("reports 60 days", text.includes("60 days"));
    check("reports the expiry date", text.includes("2026-03-02"), text);
    check("reports the scopes", text.includes("w_organization_social"));
    check("says no refresh token", text.includes("NOT returned"));

    const withRefresh = summarizeToken(
      { access_token: FAKE_TOKEN, expires_in: 5184000, refresh_token: FAKE_REFRESH, refresh_token_expires_in: 31536000 },
      now,
    ).join("\n");
    check("refresh summary never contains the refresh token", !withRefresh.includes(FAKE_REFRESH));
    check("refresh reported as returned for 365 days", withRefresh.includes("returned") && withRefresh.includes("365 days"));
    check("missing scope is reported, not crashed", summarizeToken({ access_token: FAKE_TOKEN }, now).join("\n").includes("(not reported)"));
  }

  console.log("redactSecrets");
  {
    const body = `{"error":"bad","token":"${FAKE_TOKEN}"}`;
    const red = redactSecrets(body, [FAKE_TOKEN]);
    check("secret removed", !red.includes(FAKE_TOKEN));
    check("length disclosed, value not", red.includes(`${FAKE_TOKEN.length} chars`));
    check("surrounding text kept", red.includes('"error":"bad"'));
    check("every occurrence replaced", redactSecrets(`${FAKE_TOKEN} ${FAKE_TOKEN}`, [FAKE_TOKEN]).includes(FAKE_TOKEN) === false);
    check("undefined secrets ignored", redactSecrets("plain", [undefined, ""]) === "plain");
    check("short secrets left alone", redactSecrets("a short abc text", ["abc"]) === "a short abc text");
  }

  console.log("buildAuthUrl");
  {
    const url = buildAuthUrl({ clientId: "cid", redirectUri: "https://example.org/cb", scopes: "a b", state: "s1" });
    check("no client secret in the URL", !url.includes("client_secret"));
    check("scopes url-encoded", url.includes("scope=a+b") || url.includes("scope=a%20b"), url);
    check("redirect encoded", url.includes("redirect_uri=https%3A%2F%2Fexample.org%2Fcb"));
    check("state and response_type present", url.includes("state=s1") && url.includes("response_type=code"));
  }

  console.log("writeSecretFile");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "li-selftest-"));
    const target = path.join(dir, "token");
    writeSecretFile(target, FAKE_TOKEN, false);
    check("file content is exact, no newline", fs.readFileSync(target, "utf8") === FAKE_TOKEN);
    check("mode is 0600", (fs.statSync(target).mode & 0o777) === 0o600, (fs.statSync(target).mode & 0o777).toString(8));
    let refused = false;
    try { writeSecretFile(target, "other", false); } catch { refused = true; }
    check("refuses to clobber without --force", refused);
    check("content untouched after refusal", fs.readFileSync(target, "utf8") === FAKE_TOKEN);
    fs.chmodSync(target, 0o644);
    writeSecretFile(target, "replaced", true);
    check("--force overwrites", fs.readFileSync(target, "utf8") === "replaced");
    check("--force restores mode 0600", (fs.statSync(target).mode & 0o777) === 0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("");
  if (failures.length) {
    console.log(`SELF-TEST FAILED: ${failures.length} check(s) — ${failures.join(", ")}`);
    return 1;
  }
  console.log("SELF-TEST PASSED");
  return 0;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags["self-test"] === true) {
    process.exit(selfTest());
  }
  if (parsed.errors.length) {
    for (const e of parsed.errors) console.error(e);
    usage();
    process.exit(1);
  }
  if (parsed.flags.help === true) {
    usage();
    return;
  }
  if (parsed.command === "url") return printUrl(parsed);
  if (parsed.command === "exchange") return exchange(parsed);
  if (parsed.command === "orgs") return orgs(parsed);
  usage();
  process.exit(1);
}

if (require.main === module) {
  void main();
}
