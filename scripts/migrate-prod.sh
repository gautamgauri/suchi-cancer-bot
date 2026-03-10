#!/usr/bin/env bash
# Manual migration script - executes Cloud Run migration job
# This is the "big red button" for emergency migrations

set -euo pipefail

REGION="${REGION:-us-central1}"
JOB="${JOB:-suchi-db-migrate}"

echo "Executing Cloud Run migration job: $JOB ($REGION)"
gcloud run jobs execute "$JOB" --region="$REGION" --wait
echo "✅ Migration complete!"
