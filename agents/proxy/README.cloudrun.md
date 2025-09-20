# CommunityGPT Cloud Run Proxy

This is a lightweight HTTP proxy that exposes public endpoints for your frontend and securely forwards requests to the Vertex AI Reasoning Engine.

---

## Deploy

1) Create a `.env` file with:

```
PROJECT_ID=
GCP_LOCATION=
AGENT_ENGINE_RESOURCE=
ALLOWED_ORIGIN=*
```

2) Create a service account (replace `my-project` with your project ID):

```bash
gcloud iam service-accounts create communitygpt-caller \
  --project=my-project \
  --display-name="CommunityGPT Cloud Run Caller"
```

This creates: `communitygpt-caller@my-project.iam.gserviceaccount.com`.

3) Grant it permissions to call Vertex AI Agent Engine:

```bash
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:communitygpt-caller@my-project.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

4) Deploy to Cloud Run (replace the service account project to match yours):

```bash
gcloud run deploy communitygpt-api \
  --source . \
  --region us-central1 \
  --platform managed \
  --service-account communitygpt-caller@my-project.iam.gserviceaccount.com \
  --set-env-vars-file .env \
  --allow-unauthenticated
```

After deploy, copy the Cloud Run service URL and set it as your frontend proxy URL (for example, `AGENT_PROXY_URL`) in your app’s environment.

