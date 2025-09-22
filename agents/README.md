
Usage

Sample Query

Example message you can send to /api/chat:

Give me 2 issues from August 1st 2025. Use GitHub archives.

Example Response:

Community Chat Agent
I retrieved two issues from the GitHub archive for August 1st, 2025. However, the titles are null.

SQL: SELECT JSON_VALUE(payload, '$.title') AS title
     FROM `githubarchive.day.20250801`
     WHERE type = 'IssuesEvent'
     LIMIT 2
Tables: githubarchive.day.20250801
Date: 2025-08-01
Limit: 2

(Note: titles were null because the correct JSON path is $.issue.title instead of $.title)
