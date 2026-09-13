# LinkedIn organisation-page posting — setup and token rotation

Suchi's social pipeline can publish an approved article to the **SCCF LinkedIn
company page**. The code path is live (`postLinkedIn()` in
`apps/api/src/modules/admin/social-post.service.ts`), but it stays inert until
two secrets exist and are mounted on the Cloud Run service. Everything below is
a human task: LinkedIn only issues posting tokens through a browser sign-in.

Related: issue #27, `docs/RELIABILITY_BACKLOG.md` (P2-6),
`docs/DISTRIBUTION_PIPELINE_SPEC.md` (env var table).

| What | Value |
| --- | --- |
| Env vars | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` |
| Secret Manager names | `linkedin-access-token`, `linkedin-author-urn` |
| GCP project | `gen-lang-client-0202543132` |
| API | `POST https://api.linkedin.com/rest/posts` (versioned Posts API) |
| Scope needed | `w_organization_social` (+ `r_organization_social` for step 3 only) |
| Token lifetime | **60 days**, then posting fails with HTTP 401 |
| Helper script | `scripts/linkedin-oauth-exchange.ts` (`npm run linkedin:auth -- <cmd>`) |
| Token handling | never printed; `--to-secret-manager` \| `--out` (0600) \| `--print-token` opt-in |

> **Deploy order matters.** `cloudbuild.yaml` and `cloudbuild.gated.yaml` now
> reference both secrets. Cloud Run resolves every `--set-secrets` reference at
> deploy time, so **create both secrets before the next deploy of `suchi-api`**,
> even if you only have placeholder values. A missing secret fails the deploy —
> it does not degrade gracefully.

---

## 0. Prerequisites

- A LinkedIn **company page** for Suchitra Cancer Care Foundation.
- A LinkedIn **developer app** (<https://www.linkedin.com/developers/apps>)
  whose "Company" is that page, with the **Community Management API** product
  requested and approved on the Products tab. `w_organization_social` does not
  appear in the OAuth consent screen until that product is granted.
- A LinkedIn member account that holds an **ADMINISTRATOR**, `CONTENT_ADMIN` or
  `DIRECT_SPONSORED_CONTENT_POSTER` role on the page. The token is issued to a
  *member*; it can post as the organisation only because that member administers
  it. If that person leaves SCCF, posting breaks — prefer a shared/ops account.
- A **redirect URL** registered on the app's Auth tab. It never has to serve
  anything; LinkedIn only needs to redirect a browser to it and you copy the
  `code` out of the address bar. Default used by the script:
  `https://suchicancercare.org/oauth/linkedin`. Override with
  `LINKEDIN_REDIRECT_URI` if you register something else — it must byte-match.
- Client ID and client secret from the app's Auth tab.

## 1. Find the organisation id and build the URN

Two ways, either is fine:

- **From the page URL.** Open the page as an admin. The admin URL is
  `https://www.linkedin.com/company/<numeric-id>/admin/` — the numeric id is
  what you want. (A vanity URL such as `/company/suchi-cancer-care/` does *not*
  contain the id; switch to the admin view to see it.)
- **From the API**, after step 2: `npm run linkedin:auth -- orgs` prints every
  organisation the token may post for, already in URN form. Read the token from
  a file written by `--out` with `--token-file <path>`, or export
  `LINKEDIN_ACCESS_TOKEN`.

The value to store is the full URN, not the bare number:

```
urn:li:organization:71580340       # example only — use the real SCCF id
```

`postLinkedIn()` rejects anything that is not `urn:li:organization:<id>` (or
`urn:li:person:<id>`) before it calls the API, and logs what it saw.

## 2. Authorise and exchange the code for a token

```bash
# from the repo root
export LINKEDIN_CLIENT_ID=<app client id>
export LINKEDIN_CLIENT_SECRET=<app client secret>

npm run linkedin:auth -- url
```

It prints an authorisation URL of this shape (the script fills in your client
id; `scope` is space-separated and URL-encoded):

```
https://www.linkedin.com/oauth/v2/authorization
  ?response_type=code
  &client_id=<LINKEDIN_CLIENT_ID>
  &redirect_uri=https%3A%2F%2Fsuchicancercare.org%2Foauth%2Flinkedin
  &state=suchi-<timestamp>
  &scope=w_organization_social%20r_organization_social
```

Open it in a browser **signed in as the page admin**, approve, and copy the
`code=` parameter from the URL you land on (that page may 404 — harmless).
The code expires in 30 minutes and is single-use.

```bash
# recommended: the token goes straight into Secret Manager over the child
# process's stdin — it never reaches stdout, argv, a shell history or a temp file
npm run linkedin:auth -- exchange --code <code> \
  --to-secret-manager linkedin-access-token
```

**The token is never printed.** The script prints only metadata — granted
scopes, token length, the exact expiry date, whether a refresh token came back —
and then the new Secret Manager version name. You must name exactly one
destination; with none it refuses and exits 1 rather than falling back to
printing.

| Flag | What it does |
| --- | --- |
| `--to-secret-manager <name>` | pipes the value into `gcloud secrets versions add <name> --data-file=-` and prints only the new version name. `--secret-project <id>` overrides the default project. |
| `--out <path>` | writes the raw value to a new file with mode `0600` and **no trailing newline**. Refuses to overwrite an existing file unless you add `--force`. |
| `--print-token` | the escape hatch: prints the value to stdout, after a warning. Only for a terminal you are certain is not recorded. |

If a refresh token comes back it goes to a sibling destination —
`linkedin-access-token-refresh` for `--to-secret-manager`, `<path>.refresh` for
`--out` — so neither value overwrites the other.

With `--out`, step 3's manual `gcloud` path still works, and the file is already
newline-free:

```bash
gcloud secrets versions add linkedin-access-token --data-file=<path> \
  --project=gen-lang-client-0202543132
shred -u <path>    # or rm; the file is a live 60-day credential
```

*Drop `r_organization_social` from `LINKEDIN_SCOPES` if LinkedIn has not
approved it for the app — posting needs only `w_organization_social`, and you
can read the org id off the admin URL instead (step 1).*

## 3. Store both secrets

Naming matches the `--set-secrets` entries in `cloudbuild.yaml`.

```bash
PROJECT=gen-lang-client-0202543132

# First time only — create the secret containers
gcloud secrets create linkedin-access-token --replication-policy=automatic --project=$PROJECT
gcloud secrets create linkedin-author-urn  --replication-policy=automatic --project=$PROJECT
```

`--to-secret-manager` in step 2 already added the access-token version, so only
the author URN is left — it is not a secret value, just a configuration id:

```bash
printf %s 'urn:li:organization:<id>' | \
  gcloud secrets versions add linkedin-author-urn --data-file=- --project=$PROJECT
```

Manual alternative, if you used `--out` or `--print-token` in step 2 (never edit
a version in place — always add a new one):

```bash
printf %s '<access token>' | \
  gcloud secrets versions add linkedin-access-token --data-file=- --project=$PROJECT
```

`printf %s` rather than `echo` — a trailing newline inside the token value
produces a malformed `Authorization` header and a confusing 401. Note that a
token typed on a command line lands in your shell history; `--to-secret-manager`
exists to avoid exactly that.

The Cloud Run runtime service account needs `roles/secretmanager.secretAccessor`
on both secrets (it already has it on the other `suchi-api` secrets; grant it
the same way if a deploy reports a permission error).

Both pipelines mount `latest`, so a new version takes effect on the next deploy
— no code change needed for a rotation.

## 4. Deploy

```bash
# from the repo root, on a CLEAN tree
gcloud builds submit --config cloudbuild.yaml --project gen-lang-client-0202543132
```

Then promote the new revision to 100% traffic (traffic is pinned to a named
revision — see `docs/DEPLOYMENT.md`).

## 5. Verify

0. **The helper never leaked the token.** `npm run linkedin:auth -- --self-test`
   runs the offline checks on the helper's pure parts (argument parsing,
   destination resolution, redaction, the 0600 file write);
   among them is an assertion that the exchange summary never contains the token
   value. It runs in CI in the "Build + config parity" job. If you used
   `--out`, delete the file once the secret version exists. If you used
   `--print-token`, clear the scrollback, and treat the token as compromised if
   the session was recorded.
1. **Configuration is visible.** Publish or re-send any article approval — the
   social approval email now shows a **LinkedIn** copy block and a **"LinkedIn
   only"** button, and the "Approve all" button counts 3 platforms. Those
   elements are rendered only when both LinkedIn env vars are non-empty
   (`liConfigured`), so their presence is itself the configuration check.
2. **Posting works.** Click **LinkedIn only** on a real draft and check the SCCF
   page feed. The confirmation email lists LinkedIn under published or failed.
3. **If it failed**, read the Cloud Run log for `SocialPostService`:
   - `401 — access token expired or revoked` → the 60-day token is dead, redo
     steps 2–4.
   - `403 — the token lacks w_organization_social, or the authorising member is
     not an ADMINISTRATOR/CONTENT_ADMIN` → the Community Management product is
     not approved on the app, or the member lost the page role.
   - `invalid_author_urn` → `linkedin-author-urn` is not a full URN.
   - `422` → usually the commentary; the service escapes LinkedIn "little text"
     reserved characters (`\ | { } @ [ ] ( ) < > # * _ ~`), which is why
     hashtags in LinkedIn copy render as literal text rather than links.

## 6. The 60-day expiry

LinkedIn access tokens last 60 days. **Programmatic refresh tokens are only
issued to approved Marketing Developer Platform partners**; a standard
Community Management app gets no `refresh_token`, and there is no way to renew
without a human browser sign-in. The `exchange` subcommand reports which case
this app is in — if it prints `Refresh token: returned`, the app is
refresh-eligible and a token can be renewed with:

```bash
curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
  -d grant_type=refresh_token -d refresh_token=<refresh token> \
  -d client_id=<id> -d client_secret=<secret>
```

Note that refreshing does not extend the *refresh* token (365 days from first
issue), so a full re-authorisation is still needed roughly once a year.

Rotation writes a new secret version; nothing in the repo or the Cloud Run
config changes. Prefer `--to-secret-manager linkedin-access-token` so the value
never lands anywhere else.

**Set a recurring calendar reminder at 55 days** ("Rotate Suchi LinkedIn token —
docs/LINKEDIN_ORG_POSTING.md"). Rotation is steps 2 → 3 → 4, about ten minutes.

A missed rotation is not silent any more: the 401 branch logs the expiry reason
and points at this file, and the failure shows up in the post-publish
confirmation email. It does not break Facebook or Instagram posting, and it
does not affect the chat service.

## 7. Turning LinkedIn off again

Remove the two `--set-secrets` entries from **both** `cloudbuild.yaml` and
`cloudbuild.gated.yaml` (they use replace semantics — keep them identical, and
re-run `python3 scripts/check_deploy_config_parity.py`), then deploy. With the
env vars absent, `postLinkedIn()` returns `not_configured` and the approval
email omits LinkedIn entirely. No code change is required.
