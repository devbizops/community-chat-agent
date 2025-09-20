# deploy.py
import os
import uuid
import vertexai
from vertexai import agent_engines
from agent import root_agent 

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION   = os.getenv("LOCATION")
STAGING    = os.getenv("STAGING_BUCKET")

vertexai.init(project=PROJECT_ID, location=LOCATION, staging_bucket=STAGING)

app = agent_engines.AdkApp(agent=root_agent, enable_tracing=True)

requirements = [
    "google-cloud-aiplatform[agent_engines,adk]==1.111.0",
]

env_vars = {
    "BQ_AI_CONNECTION_ID": os.getenv("BQ_AI_CONNECTION_ID"),
    "BQ_AI_ENDPOINT": os.getenv("BQ_AI_ENDPOINT"),
}

display_name = "CommunityGPT (ADK) – prod"
gcs_dir_name = os.getenv("GCS_DIR_NAME", "prod-" + str(uuid.uuid4())[:8])

service_account = os.getenv("SERVICE_ACCOUNT_EMAIL")  # optional

remote_app = agent_engines.create(
    agent_engine=app,
    requirements=requirements,
    env_vars=env_vars,
    display_name=display_name,
    gcs_dir_name=gcs_dir_name,
    service_account=service_account,
    min_instances=1,
    max_instances=10,
    resource_limits={"cpu": "4", "memory": "8Gi"},
    container_concurrency=9,
)

print("Deployment finished!")
print("Resource Name:", remote_app.resource_name)
# projects/{PROJECT_NUMBER}/locations/{LOCATION}/reasoningEngines/{RESOURCE_ID}