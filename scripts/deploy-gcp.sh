#!/bin/bash
# Automated deployment script for Google Cloud Platform
# This script builds and deploys Suchi Cancer Bot to Cloud Run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration variables (set these or pass as environment variables)
PROJECT_ID=${GCP_PROJECT_ID:-""}
REGION=${GCP_REGION:-"us-central1"}
ARTIFACT_REGISTRY=${ARTIFACT_REGISTRY:-"suchi-images"}
API_SERVICE_NAME=${API_SERVICE_NAME:-"suchi-api"}
WEB_SERVICE_NAME=${WEB_SERVICE_NAME:-"suchi-web"}

# Check if required tools are installed
command -v gcloud >/dev/null 2>&1 || { echo -e "${RED}Error: gcloud CLI is not installed${NC}" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: Docker is not installed${NC}" >&2; exit 1; }

# Check if PROJECT_ID is set
if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}Warning: GCP_PROJECT_ID is not set. Using default from gcloud config.${NC}"
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
    if [ -z "$PROJECT_ID" ]; then
        echo -e "${RED}Error: Could not determine GCP project ID${NC}" >&2
        exit 1
    fi
fi

echo -e "${GREEN}Deploying Suchi Cancer Bot to Google Cloud Platform${NC}"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Artifact Registry: $ARTIFACT_REGISTRY"
echo ""

# Set the project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo -e "${YELLOW}Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com

# Create Artifact Registry repository if it doesn't exist
echo -e "${YELLOW}Setting up Artifact Registry...${NC}"
if ! gcloud artifacts repositories describe "$ARTIFACT_REGISTRY" --location="$REGION" >/dev/null 2>&1; then
    echo "Creating Artifact Registry repository..."
    gcloud artifacts repositories create "$ARTIFACT_REGISTRY" \
        --repository-format=docker \
        --location="$REGION" \
        --description="Docker images for Suchi Cancer Bot"
else
    echo "Artifact Registry repository already exists"
fi

# Configure Docker authentication
echo -e "${YELLOW}Configuring Docker authentication...${NC}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

# Get the current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Build and push API image
echo -e "${YELLOW}Building and pushing API image...${NC}"
cd "$PROJECT_ROOT/apps/api"
docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${API_SERVICE_NAME}:latest" .
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${API_SERVICE_NAME}:latest"

# Build and push Web image
# Note: VITE_API_URL should be set to the API service URL
API_URL=${API_URL:-"https://${API_SERVICE_NAME}-$(echo $PROJECT_ID | cut -d'-' -f1).${REGION}.run.app/v1"}
echo -e "${YELLOW}Building and pushing Web image with API_URL=${API_URL}...${NC}"
cd "$PROJECT_ROOT/apps/web"
docker build \
    --build-arg VITE_API_URL="${API_URL}" \
    -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${WEB_SERVICE_NAME}:latest" .
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${WEB_SERVICE_NAME}:latest"

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying API service...${NC}"
# Note: You'll need to configure secrets and Cloud SQL connection
# This is a simplified version - see docs/GCP_DEPLOYMENT.md for full configuration
gcloud run deploy "$API_SERVICE_NAME" \
    --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${API_SERVICE_NAME}:latest" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --port 8080 \
    --set-env-vars "PORT=8080,NODE_ENV=production,EMBEDDING_MODEL=text-embedding-004" \
    || echo -e "${YELLOW}Warning: API deployment may need additional configuration (secrets, Cloud SQL)${NC}"

echo -e "${YELLOW}Deploying Web service...${NC}"
gcloud run deploy "$WEB_SERVICE_NAME" \
    --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/${WEB_SERVICE_NAME}:latest" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 256Mi \
    --cpu 1 \
    --port 8080 \
    --set-env-vars "VITE_API_URL=${API_URL}" \
    || echo -e "${YELLOW}Warning: Web deployment may need additional configuration${NC}"

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Configure Cloud SQL connection and secrets (see docs/GCP_DEPLOYMENT.md)"
echo "2. Run database migrations: cd apps/api && ./scripts/migrate-cloud.sh"
echo "3. Ingest KB: npm run kb:ingest"
echo "4. Test your deployment"



















