#!/usr/bin/env bash
#
# One-time setup for the nightly Suchi Autoresearch loop.
#
# Creates:
#   1. gemini-api-key secret in Secret Manager (if missing)
#   2. Cloud Build trigger named "autoresearch-nightly"
#   3. Cloud Scheduler job that fires the trigger every night at 22:00 IST
#
# Idempotent — safe to re-run; existing resources are kept.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0202543132}"
REGION="${REGION:-us-central1}"
SCHEDULER_SA="suchi-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
TRIGGER_NAME="autoresearch-nightly"
SCHEDULER_JOB="autoresearch-nightly"
# 22:00 IST = 16:30 UTC. Cron is in UTC.
SCHEDULE="30 16 * * *"
TIMEZONE="Etc/UTC"

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }

require_cmd() { command -v "$1" >/dev/null || { red "Missing $1. Install it first."; exit 1; }; }
require_cmd gcloud

bold "Suchi Autoresearch — nightly setup"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "  SA:      ${SCHEDULER_SA}"
echo

# ── 1. Ensure gemini-api-key secret exists ─────────────────────────────────
bold "[1/3] Checking gemini-api-key secret..."
if gcloud secrets describe gemini-api-key --project="${PROJECT_ID}" >/dev/null 2>&1; then
  green "  Secret 'gemini-api-key' already exists."
else
  yellow "  Secret 'gemini-api-key' is missing."
  echo "  Create it now? You'll need a Gemini API key from https://aistudio.google.com/apikey"
  read -r -p "  Paste API key (or press Enter to skip and create later): " KEY_VALUE
  if [ -n "${KEY_VALUE:-}" ]; then
    printf '%s' "${KEY_VALUE}" | gcloud secrets create gemini-api-key \
      --data-file=- \
      --replication-policy=automatic \
      --project="${PROJECT_ID}"
    green "  Secret created."
  else
    yellow "  Skipped. The nightly job will fail until you create the secret:"
    yellow "    printf 'YOUR_KEY' | gcloud secrets create gemini-api-key --data-file=- --replication-policy=automatic --project=${PROJECT_ID}"
  fi
fi

# Grant scheduler SA access to both required secrets.
bold "[1b/3] Granting ${SCHEDULER_SA} access to secrets..."
for secret in gemini-api-key SMTP_PASS; do
  if gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "${secret}" \
      --member="serviceAccount:${SCHEDULER_SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --project="${PROJECT_ID}" >/dev/null
    green "  Bound ${SCHEDULER_SA} -> secretmanager.secretAccessor on ${secret}"
  else
    yellow "  Skipping IAM binding for ${secret} — secret does not exist."
  fi
done

# ── 2. Cloud Build trigger ─────────────────────────────────────────────────
bold "[2/3] Creating Cloud Build trigger '${TRIGGER_NAME}'..."
if gcloud builds triggers describe "${TRIGGER_NAME}" --region="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  green "  Trigger already exists."
else
  # Manual trigger — invoked by Cloud Scheduler, not by git events. Source is
  # whatever branch Cloud Build pulls; we use the GitHub-connected repo if
  # available, else inline source via gcloud. Adjust --repo-name / --branch
  # for your GitHub connection.
  yellow "  Trigger does not exist."
  echo
  echo "  Create it manually with the GitHub repo connected to this Cloud Build,"
  echo "  e.g.:"
  echo
  echo "    gcloud builds triggers create manual \\"
  echo "      --name=${TRIGGER_NAME} \\"
  echo "      --region=${REGION} \\"
  echo "      --project=${PROJECT_ID} \\"
  echo "      --repo=projects/${PROJECT_ID}/locations/${REGION}/connections/<CONN>/repositories/<REPO> \\"
  echo "      --branch=main \\"
  echo "      --build-config=cloudbuild-autoresearch.yaml \\"
  echo "      --service-account=projects/${PROJECT_ID}/serviceAccounts/${SCHEDULER_SA}"
  echo
  echo "  (Replace <CONN> and <REPO> with your Cloud Build GitHub connection IDs."
  echo "   List them with: gcloud builds connections list --region=${REGION})"
  echo
  read -r -p "  Press Enter once the trigger is created to continue, or Ctrl-C to abort: "
fi

TRIGGER_ID=$(gcloud builds triggers describe "${TRIGGER_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(id)' 2>/dev/null || echo "")
if [ -z "${TRIGGER_ID}" ]; then
  red "Trigger '${TRIGGER_NAME}' still missing — cannot continue."
  exit 1
fi
green "  Trigger ID: ${TRIGGER_ID}"

# ── 3. Cloud Scheduler job ─────────────────────────────────────────────────
bold "[3/3] Creating Cloud Scheduler job '${SCHEDULER_JOB}' (${SCHEDULE} ${TIMEZONE})..."
TRIGGER_URL="https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/triggers/${TRIGGER_ID}:run"

if gcloud scheduler jobs describe "${SCHEDULER_JOB}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  yellow "  Scheduler job already exists. Updating cron + URI..."
  gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="${SCHEDULE}" \
    --time-zone="${TIMEZONE}" \
    --http-method=POST \
    --uri="${TRIGGER_URL}" \
    --message-body='{"branchName":"main"}' \
    --headers='Content-Type=application/json' \
    --oauth-service-account-email="${SCHEDULER_SA}" \
    --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform'
  green "  Scheduler job updated."
else
  gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="${SCHEDULE}" \
    --time-zone="${TIMEZONE}" \
    --http-method=POST \
    --uri="${TRIGGER_URL}" \
    --message-body='{"branchName":"main"}' \
    --headers='Content-Type=application/json' \
    --oauth-service-account-email="${SCHEDULER_SA}" \
    --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform'
  green "  Scheduler job created."
fi

# Grant the SA the role to invoke the build trigger.
bold "[3b/3] Granting ${SCHEDULER_SA} the Cloud Build editor role on the project..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/cloudbuild.builds.editor" >/dev/null
green "  Done."

bold ""
bold "Setup complete."
echo
echo "  Schedule:    ${SCHEDULE} ${TIMEZONE} (= 22:00 IST)"
echo "  Trigger:     gcloud builds triggers run ${TRIGGER_NAME} --region=${REGION} --branch=main"
echo "  List jobs:   gcloud scheduler jobs list --location=${REGION}"
echo "  Force run:   gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION}"
echo "  Logs:        gcloud builds list --filter='trigger_id=${TRIGGER_ID}' --limit=10"
echo
green "Email summaries will land at gautamgauri@dikshafoundation.org after each run."
