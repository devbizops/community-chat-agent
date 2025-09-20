#!/usr/bin/env bash
set -euo pipefail

# One-click deployment: Vertex AI Agent Engine + Cloud Run proxy
# - Creates service accounts (if missing)
# - Deploys the Agent Engine (prints reasoningEngines resource)
# - Writes proxy .env with AGENT_ENGINE_RESOURCE
# - Deploys Cloud Run proxy and prints its URL

### Configuration
# Provide values via environment variables or an --env-file path.
# Required:
#   PROJECT_ID              
#   LOCATION                e.g. us-central1 (used by Agent Engine)
#   STAGING_BUCKET          e.g. gs://my-agent-staging
#   BQ_AI_CONNECTION_ID     e.g. myproj.us.my_vertex_conn
# Optional:
#   BQ_AI_ENDPOINT          default: gemini-2.0-flash
#   ALLOWED_ORIGIN          default: *
#   RUN_REGION              default: $LOCATION (Cloud Run region)
#   ENGINE_SA_NAME          default: communitygpt-engine
#   PROXY_SA_NAME           default: communitygpt-caller
#   PROXY_SERVICE_NAME      default: communitygpt-api

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
AGENTS_DIR="$ROOT_DIR/agents"
PROXY_DIR="$AGENTS_DIR/proxy"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--env-file path]

Env vars required:
  PROJECT_ID, LOCATION, STAGING_BUCKET, BQ_AI_CONNECTION_ID
Optional:
  BQ_AI_ENDPOINT, ALLOWED_ORIGIN, RUN_REGION, ENGINE_SA_NAME, PROXY_SA_NAME, PROXY_SERVICE_NAME

Example:
  $(basename "$0") --env-file $AGENTS_DIR/deploy.env
EOF
}

ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"; shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Env file not found: $ENV_FILE" >&2; exit 1
  fi
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

required_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

required_var PROJECT_ID
required_var LOCATION
required_var STAGING_BUCKET
required_var BQ_AI_CONNECTION_ID

export BQ_AI_ENDPOINT=${BQ_AI_ENDPOINT:-gemini-2.0-flash}
export ALLOWED_ORIGIN=${ALLOWED_ORIGIN:-*}
export RUN_REGION=${RUN_REGION:-$LOCATION}
ENGINE_SA_NAME=${ENGINE_SA_NAME:-communitygpt-engine}
PROXY_SA_NAME=${PROXY_SA_NAME:-communitygpt-caller}
PROXY_SERVICE_NAME=${PROXY_SERVICE_NAME:-communitygpt-api}

echo "==> Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Ensuring required APIs are enabled"
gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  --project "$PROJECT_ID" >/dev/null

echo "==> Ensuring staging bucket exists: $STAGING_BUCKET"
if ! gsutil ls -b "$STAGING_BUCKET" >/dev/null 2>&1; then
  gsutil mb -l "$LOCATION" "$STAGING_BUCKET"
fi

ENGINE_SA_EMAIL="${ENGINE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROXY_SA_EMAIL="${PROXY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Creating/ensuring Agent Engine runtime service account: $ENGINE_SA_EMAIL"
if ! gcloud iam service-accounts describe "$ENGINE_SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$ENGINE_SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="CommunityGPT Agent Engine Runtime"
fi

echo "==> Granting BigQuery read role to $ENGINE_SA_EMAIL (adjust roles as needed)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${ENGINE_SA_EMAIL}" \
  --role="roles/bigquery.user" >/dev/null

echo "==> Creating/ensuring Cloud Run caller service account: $PROXY_SA_EMAIL"
if ! gcloud iam service-accounts describe "$PROXY_SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$PROXY_SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="CommunityGPT Cloud Run Caller"
fi

echo "==> Granting Vertex AI user role to $PROXY_SA_EMAIL"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROXY_SA_EMAIL}" \
  --role="roles/aiplatform.user" >/dev/null

echo "==> Setting up Python environment for Agent Engine deployment"
VENV_DIR="$AGENTS_DIR/.venv"
python3 -m venv "$VENV_DIR"
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"
pip install --upgrade pip >/dev/null
pip install "google-cloud-aiplatform[agent_engines,adk]==1.111.0" >/dev/null

echo "==> Deploying Agent Engine via deploy_agent.py"
pushd "$AGENTS_DIR" >/dev/null
export PROJECT_ID LOCATION STAGING_BUCKET BQ_AI_CONNECTION_ID BQ_AI_ENDPOINT SERVICE_ACCOUNT_EMAIL="$ENGINE_SA_EMAIL"
set +e
DEPLOY_OUT=$(python deploy_agent.py 2>&1)
RET=$?
set -e
popd >/dev/null
echo "$DEPLOY_OUT"
if [[ $RET -ne 0 ]]; then
  echo "Agent Engine deployment failed" >&2
  exit $RET
fi

echo "==> Parsing Agent Engine resource name"
ENGINE_RESOURCE=$(echo "$DEPLOY_OUT" | sed -n 's/^Resource Name:\s*//p' | tail -n1)
if [[ -z "$ENGINE_RESOURCE" ]]; then
  # Fallback: find first projects/.../reasoningEngines/... token
  ENGINE_RESOURCE=$(echo "$DEPLOY_OUT" | grep -oE 'projects/[^[:space:]]+/locations/[^[:space:]]+/reasoningEngines/[^[:space:]]+' | head -n1 || true)
fi
if [[ -z "$ENGINE_RESOURCE" ]]; then
  echo "Could not determine Agent Engine resource name from deploy output." >&2
  exit 1
fi
echo "Agent Engine: $ENGINE_RESOURCE"

echo "==> Writing proxy .env"
cat > "$PROXY_DIR/.env" <<ENVVARS
PROJECT_ID=$PROJECT_ID
GCP_LOCATION=$LOCATION
AGENT_ENGINE_RESOURCE=$ENGINE_RESOURCE
ALLOWED_ORIGIN=$ALLOWED_ORIGIN
ENVVARS

echo "==> Deploying Cloud Run proxy: $PROXY_SERVICE_NAME (region: $RUN_REGION)"
pushd "$PROXY_DIR" >/dev/null
gcloud run deploy "$PROXY_SERVICE_NAME" \
  --source . \
  --region "$RUN_REGION" \
  --platform managed \
  --service-account "$PROXY_SA_EMAIL" \
  --set-env-vars-file .env \
  --allow-unauthenticated

SERVICE_URL=$(gcloud run services describe "$PROXY_SERVICE_NAME" --region "$RUN_REGION" --format 'value(status.url)')
popd >/dev/null

echo
echo "✅ Done!"
echo "Agent Engine Resource: $ENGINE_RESOURCE"
echo "Cloud Run Proxy URL:  $SERVICE_URL"
echo
echo "Next steps:"
echo "- Set AGENT_PROXY_URL=$SERVICE_URL in your frontend environment."
echo "- Optionally set a PUBLIC_API_KEY in Cloud Run env and forward 'x-api-key' from the app."

