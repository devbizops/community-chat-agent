# agent.py
from __future__ import annotations
import os

from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.tools.bigquery import BigQueryToolset, BigQueryCredentialsConfig
from google.adk.tools.bigquery.config import BigQueryToolConfig, WriteMode
import google.auth

load_dotenv()

# ---- Config ----
BQ_AI_CONNECTION_ID = os.environ["BQ_AI_CONNECTION_ID"] 
BQ_AI_ENDPOINT = os.getenv("BQ_AI_ENDPOINT", "gemini-2.0-flash")

# ---- Built-in BigQuery toolset (first-party) ----
# Use Application Default Credentials (gcloud auth application-default login, or service acct)
adc, _ = google.auth.default()
credentials_config = BigQueryCredentialsConfig(credentials=adc)

# Block writes for safety (read-only)
tool_config = BigQueryToolConfig(write_mode=WriteMode.BLOCKED)

bigquery_tools = BigQueryToolset(
    credentials_config=credentials_config,
    bigquery_tool_config=tool_config,
    # optionally: tool_filter=["execute_sql", "get_table_info", "list_table_ids"]
)

# ---- System instruction with few-shot examples using AI.GENERATE_BOOL ----
# ---- Zero-shot system instruction emphasizing AI.GENERATE_BOOL ----
INSTRUCTION = f"""
You are Community Chat Agent, orchestrated with Google ADK. You answer by planning, then
calling the built-in BigQuery tools (e.g., execute_sql). Your SQL may embed
BigQuery AI functions such as AI.GENERATE_BOOL so the database performs semantic
work inline.

GROUND RULES
• Always use BigQuery tools to answer (execute_sql). Do not invent data.
• User is always right in the date. If they say it's 2025 it is 2025!
• Every SQL MUST include:
  – a date/partition filter, and
  – a LIMIT (and avoid SELECT *).
• After every tool call, briefly summarize counts/deltas and add a provenance
  footer: referenced tables, date window, LIMIT, and billed MB if available.
• In AI.GENERATE_BOOL, always use the two-argument tuple form:
    AI.GENERATE_BOOL(
      (
        '<classification question or instruction>',
        <string expression to classify>
      ),
      connection_id => '{BQ_AI_CONNECTION_ID}',
      endpoint      => '{BQ_AI_ENDPOINT}'
    ).result

EVENT ANALYTICS (GH ARCHIVE)
• Use the public GH Archive on BigQuery for GitHub event streams (hourly updates).
• Prefer one of these forms and ALWAYS restrict by time:
  A) Unified table (if present in your project):
     FROM `gharchive.events`
     WHERE created_at >= TIMESTAMP('') AND created_at < TIMESTAMP('')
  B) Year/Month/Day tables with wildcards:
     FROM `githubarchive.day.2015*`         -- or .month.YYYY*, .year.20*
     WHERE _TABLE_SUFFIX BETWEEN '' AND ''   -- e.g. '0101' AND '0105'
• Only select needed columns; use JSON functions to access payload:
     JSON_VALUE(payload, '$.action') AS action
• Always include LIMIT at the end.

SAFETY & COST
• Always include LIMIT. 
• Never rejoin the raw commits table after you’ve materialized the repo list.
• Never use AI.GENERATE_BOOL directly in a WHERE clause on the raw table!
  Always apply a LIMIT first to create a bounded candidate set, then call
  AI.GENERATE_BOOL in a SELECT over that limited set. Finally, filter on
  `.result` in an outer query. This ensures the model runs only on the
  capped rows, not the entire table.
• Every SQL MUST include both a date filter and a LIMIT. 
  – If the user request does not specify a date, default to the single day 
    `2025-08-01` (use `githubarchive.day.20250801` or the equivalent date 
    filter on commits). 
  – If the user request does not specify a LIMIT, default to `LIMIT 10`. 
"""

# ---- Build the agent using the built-in toolset ----
root_agent = Agent(
    name="community_analytics_agent",
    model=os.getenv("ADK_MODEL", "gemini-2.0-flash"),
    description="Answers community analytics questions by composing SQL with AI.GENERATE_BOOL and running it via BigQuery built-in tools.",
    instruction=INSTRUCTION,
    tools=[bigquery_tools],
)

# ---- Runner helper ----
def run_once(message: str) -> str:
    runner = Runner(app_name="community-gpt", agent=root_agent)
    events = runner.run(user_id="luna", session_id="local", input_text=message)
    for ev in events:
        if getattr(ev, "is_final_response", lambda: False)():
            c = ev.get_content()
            if c and c.parts:
                return c.parts[0].text or ""
    return ""

if __name__ == "__main__":
    print(run_once("Compare ADK vs OpenAI Agents SDK adoption for August 2025 using AI.GENERATE_BOOL."))
