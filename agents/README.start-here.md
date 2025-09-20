# CommunityGPT Agents — Start Here

This is the quickest path to get both the Vertex AI Agent Engine and the Cloud Run Proxy running for CommunityGPT.

---

## 1) Start with the Agent Engine

Begin in the Agent Engine section. Follow:
- `chat-demo/agents/README.agent-engine.md`

Complete the initial setup in your GCP project:
- Enable APIs, create a regional GCS staging bucket
- Decide the location (e.g., `us-central1`)
- Create or identify a BigQuery AI connection for `AI.GENERATE_BOOL`

Collect these values (you can put them in an env file next):
- `PROJECT_ID`
- `LOCATION` (e.g., `us-central1`)
- `STAGING_BUCKET` (e.g., `gs://your-agent-staging`)
- `BQ_AI_CONNECTION_ID` (e.g., `your-project.us.your_vertex_conn`)
- Optional: `BQ_AI_ENDPOINT` (default `gemini-2.0-flash`), `SERVICE_ACCOUNT_EMAIL`

---

## 2) Put values in an .env and run the one‑click deploy

Create an env file (example: `chat-demo/agents/deploy.env`) with your values:

```
PROJECT_ID=your-project
LOCATION=us-central1
STAGING_BUCKET=gs://your-agent-staging
BQ_AI_CONNECTION_ID=your-project.us.your_vertex_conn
# Optional
BQ_AI_ENDPOINT=gemini-2.0-flash
ALLOWED_ORIGIN=*
RUN_REGION=us-central1
ENGINE_SA_NAME=communitygpt-engine
PROXY_SA_NAME=communitygpt-caller
PROXY_SERVICE_NAME=communitygpt-api
```

Run the script to deploy both the Agent Engine and the Cloud Run proxy:

```bash
bash chat-demo/agents/deploy_all.sh --env-file chat-demo/agents/deploy.env
```

The script will:
- Ensure/assign service accounts and IAM
- Deploy the Agent Engine and print the `reasoningEngines/...` resource name
- Write the proxy `.env` with `AGENT_ENGINE_RESOURCE`
- Deploy the Cloud Run proxy and print its URL

---

## 3) Point the frontend at your proxy

Add the Cloud Run URL to your app env (e.g., `chat-demo/.env.local`):

```
AGENT_PROXY_URL=https://<your-cloud-run-url>
# Optional if you configured a key check on the proxy
AGENT_PROXY_KEY=<your-proxy-key>
```

Start the app:

```bash
cd chat-demo
npm install
npm run dev
```

Open `http://localhost:3000` and chat. The app will use the proxy first and fall back to Claude only if needed.

---

## References
- Agent Engine deployment: `chat-demo/agents/README.agent-engine.md`
- Cloud Run proxy deployment: `chat-demo/agents/proxy/README.cloudrun.md`
- Full run guide: `chat-demo/README.run.md`
