# Community Chat Agent Hackathon Frontend

This folder contains the trimmed Next.js app that powers the Community Chat Agent chat experience. It keeps only the files needed for the real-time chat UI and agent proxy integration.

## Quick start

```bash
npm install
npm run dev
```

Before running the app, copy `.env.example` to `.env.local` (or `.env`) and fill in the required keys.

## Included
- `/src/app/page.tsx` and `/src/components/chat-interface.tsx` for the Community Chat Agent UI
- `/src/app/api/chat` for routing messages through the agent proxy 
- `/src/lib` and `/src/types` utilities referenced by the chat flow
- Tailwind 4 setup (`globals.css`, PostCSS config) and UI primitives
- Public assets used by the chat shell

## Notes
- Set `DEBUG_AGENT_PROXY=true` locally if you need verbose logging while talking to the agent proxy.
