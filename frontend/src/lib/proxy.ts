// session-aware client for your Agent Engine proxy (with success/error logs)

type StreamResult = {
  text: string;
  rows: unknown[];
  eventsSeen: number;
  linesSeen: number;
  debug: string[];
};

const AGENT_PROXY_URL = process.env.AGENT_PROXY_URL || '';
const AGENT_PROXY_KEY = process.env.AGENT_PROXY_KEY || ''; // optional; adds x-api-key
const DEBUG_AGENT_PROXY =
  (process.env.DEBUG_AGENT_PROXY ?? process.env.NODE_ENV === 'development' ? 'true' : '')
    .toString()
    .toLowerCase() === 'true';

// -----------------------------
// Logging helpers
// -----------------------------
function log(...args: unknown[]) {
  if (DEBUG_AGENT_PROXY) console.log('[AgentProxy]', ...args);
}
function warn(...args: unknown[]) {
  if (DEBUG_AGENT_PROXY) console.warn('[AgentProxy]', ...args);
}
function error(...args: unknown[]) {
  console.error('[AgentProxy]', ...args);
}

// -----------------------------
// Simple session store
// -----------------------------
let memSessionId: string | null = null;

function storageKey(userId: string, threadId = 'default') {
  return `ae.session.${userId}.${threadId}`;
}

function getSessionIdFromStore(userId: string, threadId = 'default') {
  const key = storageKey(userId, threadId);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const sid = localStorage.getItem(key);
      if (sid) log('Loaded session from storage', { userId, threadId, sessionId: sid });
      return sid || null;
    }
  } catch {}
  return memSessionId;
}

function saveSessionIdToStore(userId: string, sid: string, threadId = 'default') {
  const key = storageKey(userId, threadId);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, sid);
      log('Saved session to storage', { userId, threadId, sessionId: sid });
    } else {
      memSessionId = sid;
      log('Saved session to memory (SSR)', { userId, threadId, sessionId: sid });
    }
  } catch {
    memSessionId = sid;
    warn('localStorage unavailable; using in-memory session', { userId, threadId, sessionId: sid });
  }
}

export function resetSession(userId: string, threadId = 'default') {
  const key = storageKey(userId, threadId);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(key);
      log('Removed session from storage', { userId, threadId });
    } else {
      memSessionId = null;
      log('Cleared in-memory session (SSR)', { userId, threadId });
    }
  } catch {
    memSessionId = null;
    warn('Failed to remove from localStorage; cleared memory session', { userId, threadId });
  }
}

// -----------------------------
// URL helpers
// -----------------------------
function buildStreamUrl(base: string): string {
  try {
    const u = new URL(base);
    let path = u.pathname.replace(/\/+$/, '');
    if (path.endsWith('/chat/stream')) return u.toString();
    if (path.endsWith('/chat')) path += '/stream';
    else path = (path ? path : '') + '/chat/stream';
    u.pathname = path;
    return u.toString();
  } catch {
    return base.replace(/\/+$/, '') + '/chat/stream';
  }
}
function buildSessionUrl(base: string): string {
  try {
    const u = new URL(base);
    let path = u.pathname.replace(/\/+$/, '');
    path = (path ? path : '') + '/session';
    u.pathname = path;
    return u.toString();
  } catch {
    return base.replace(/\/+$/, '') + '/session';
  }
}

// -----------------------------
// Ensure we have a session id
// -----------------------------
async function ensureSessionId(
  baseUrl: string,
  userId: string,
  headers?: Record<string, string>,
  threadId = 'default'
) {
  const existing = getSessionIdFromStore(userId, threadId);
  if (existing) return existing;

  const url = buildSessionUrl(baseUrl);
  log('Creating new session via proxy', { url, userId, threadId });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AGENT_PROXY_KEY ? { 'x-api-key': AGENT_PROXY_KEY } : {}),
      ...(headers ?? {}),
    },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    error('❌ /session failed', { status: res.status, body: t });
    throw new Error(`Failed to create session: ${res.status} ${t}`);
  }

  const data = await res.json().catch(() => ({}));
  const sid = data?.session_id;
  if (typeof sid !== 'string' || !sid) {
    error('❌ /session did not return session_id', { data });
    throw new Error('Proxy /session did not return a session_id');
  }

  log('✅ /session ok', { userId, threadId, sessionId: sid });
  saveSessionIdToStore(userId, sid, threadId);
  return sid;
}

// Optional: force a new session on demand
export async function startNewSession(
  baseUrl: string,
  userId: string,
  headers?: Record<string, string>,
  threadId = 'default'
) {
  resetSession(userId, threadId);
  return ensureSessionId(baseUrl, userId, headers, threadId);
}

// -----------------------------
// Main call with SSE
// -----------------------------
export async function queryAgentProxy(
  message: string,
  headers?: Record<string, string>,
  userId: string = 'user',
  threadId: string = 'default'
): Promise<StreamResult> {
  if (!AGENT_PROXY_URL) throw new Error('AGENT_PROXY_URL is not set');

  const streamUrl = buildStreamUrl(AGENT_PROXY_URL);

  // 1) Make sure we have a session id (creates once if missing)
  let sessionId = await ensureSessionId(AGENT_PROXY_URL, userId, headers, threadId);

  log('→ Calling proxy /chat/stream', { streamUrl, userId, sessionId, threadId });

  // 2) Stream the request, passing session_id
  const res = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      'Cache-Control': 'no-cache',
      ...(AGENT_PROXY_KEY ? { 'x-api-key': AGENT_PROXY_KEY } : {}),
      ...(headers ?? {}),
    },
    body: JSON.stringify({ message, user_id: userId, session_id: sessionId }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    error('❌ Proxy call failed', { status: res.status, body: t });
    throw new Error(`Proxy error ${res.status}: ${t}`);
  } else {
    log('✅ Proxy call accepted', { status: res.status, contentType: res.headers.get('content-type') });
  }

  const contentType = res.headers.get('content-type') || '';
  const isSSE = contentType.includes('text/event-stream');

  const rows: unknown[] = [];
  let textOut = '';
  let eventsSeen = 0;
  let linesSeen = 0;
  const debug: string[] = [];

  const addText = (value: unknown) => {
    if (!value) return;
    if (typeof value === 'string') {
      textOut += value;
      return;
    }
    if (typeof value === 'object' && value !== null && 'text' in value) {
      const maybeText = (value as { text?: unknown }).text;
      if (typeof maybeText === 'string') textOut += maybeText;
    }
  };
  const pushRows = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      rows.push(...value);
      return;
    }
    rows.push(value);
  };

  // Capture a session prelude if proxy emits it
  const maybeCaptureSessionPrelude = (payloadStr: string) => {
    try {
      const evt = JSON.parse(payloadStr);
      if (evt?.type === 'session' && typeof evt?.session_id === 'string') {
        sessionId = evt.session_id;
        saveSessionIdToStore(userId, sessionId, threadId);
        log('Captured session prelude from SSE', { sessionId });
      }
    } catch {
      // ignore
    }
  };

  if (isSSE && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEvent = (payloadStr: string) => {
      if (!payloadStr || payloadStr === '[DONE]') return;
      eventsSeen++;
      if (debug.length < 50) debug.push(payloadStr); 

      maybeCaptureSessionPrelude(payloadStr);

      // parse content tokens
      try {
        const evt = JSON.parse(payloadStr);
        const parts = evt?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            addText(p?.text);
            const fr = p?.function_response?.response;
            if (fr) {
              if ('rows' in fr) pushRows(fr.rows);
              if ('result' in fr) pushRows(fr.result);
            }
          }
        }
        addText(evt?.output);
        addText(evt?.output?.delta);
        addText(evt?.message);
        addText(evt?.text);
        if (evt?.rows) pushRows(evt.rows);
        if (evt?.data?.rows) pushRows(evt.data.rows);
      } catch {
        // non-JSON chunks are fine; ignore
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        linesSeen++;
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data:')) {
          const payload = trimmed.replace(/^data:\s?/, '');
          if (payload === '[DONE]') break;
          handleEvent(payload);
        } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          if (trimmed === '[DONE]') break;
          handleEvent(trimmed);
        } else if (trimmed === '[DONE]') {
          break;
        }
      }
    }

    log('SSE completed', { eventsSeen, linesSeen, bytesApprox: buffer.length });
  } else {
    // Non-SSE fallback
    warn('Non-SSE response received from proxy');
    const body = await res.json().catch(async () => {
      const t = await res.text().catch(() => '');
      return { message: t };
    });
    const pick = (value: unknown): unknown => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return (
          obj.message ??
          obj.content ??
          obj.text ??
          obj.output ??
          (obj.data && typeof obj.data === 'object'
            ? (obj.data as Record<string, unknown>).message ?? (obj.data as Record<string, unknown>).content
            : undefined) ??
          ''
        );
      }
      return '';
    };
    const text = pick(body);
    textOut = typeof text === 'string' ? text : JSON.stringify(text);
    const possibleRows = body?.rows ?? body?.data?.rows ?? body?.result ?? body?.data?.result;
    pushRows(possibleRows);
    debug.push(JSON.stringify(body).slice(0, 1000));
  }

  log('Returning StreamResult', { textLen: textOut.length, rows: rows.length, eventsSeen, linesSeen });
  return { text: textOut.trim(), rows, eventsSeen, linesSeen, debug };
}
