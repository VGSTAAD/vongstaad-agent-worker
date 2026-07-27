interface Env {
  EMBASSIES_DB: D1Database;
  AUTH_WORKER_URL: string;
  GEMINI_API_KEY_1?: string;
  GEMINI_API_KEY_2?: string;
  GEMINI_API_KEY_3?: string;
  GEMINI_API_KEY_4?: string;
  GEMINI_API_KEY_5?: string;
  GEMINI_API_KEY_6?: string;
  GEMINI_API_KEY_7?: string;
  GEMINI_API_KEY_8?: string;
  GEMINI_API_KEY_9?: string;
  GEMINI_API_KEY_10?: string;
  GEMINI_API_KEY_11?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embassy-Secret',
};

function corsResponse(body: BodyInit | null, init?: ResponseInit): Response {
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  return new Response(body, { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, { status: 204 });
    }

    // Health check
    if (path === '/health') return new Response('OK');

    // Embassy endpoints
    if (path === '/register-embassy' && request.method === 'POST') {
      return handleRegisterEmbassy(request, env);
    }
    if (path === '/get-active-embassies') {
      return handleGetEmbassies(env);
    }

    // Command queue endpoints
    if (path === '/command' && request.method === 'POST') {
      return handleCommandPost(request, env);
    }
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'GET') {
      return handleCommandGet(request, env, path);
    }
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'PATCH') {
      return handleCommandPatch(request, env, path);
    }
    if (path === '/command/pending' && request.method === 'GET') {
      return handleCommandPending(env);
    }

    
  // Gemini relay endpoint (uses Worker secrets)
  if (path === '/gemini/complete' && request.method === 'POST') {
    const body = await request.json() as any;
    const prompt = body.prompt || '';
    const keys = [
      env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3,
      env.GEMINI_API_KEY_4, env.GEMINI_API_KEY_5, env.GEMINI_API_KEY_6,
      env.GEMINI_API_KEY_7, env.GEMINI_API_KEY_8, env.GEMINI_API_KEY_9,
      env.GEMINI_API_KEY_10, env.GEMINI_API_KEY_11
    ].filter(Boolean);

    if (keys.length === 0) return corsResponse(JSON.stringify({ error: 'No Gemini keys configured' }), { status: 500 });

    let lastError = null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const geminiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }]
            })
          }
        );
        const data = await geminiResp.json() as any;
        if (data.error) {
          lastError = data.error;
          continue;
        }
        return corsResponse(JSON.stringify({ text: data.candidates[0].content.parts[0].text }));
      } catch (err) {
        lastError = err;
      }
    }
    return corsResponse(JSON.stringify({ error: `All keys exhausted: ${lastError?.message || 'unknown'}` }), { status: 502 });
  }

  return corsResponse('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    await env.EMBASSIES_DB.prepare(
      'DELETE FROM embassies WHERE last_seen < ?'
    ).bind(fiveMinutesAgo).run();
  }
};

async function handleRegisterEmbassy(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get('X-Embassy-Secret') || '';
  if (secret !== 'vongstaad-embassy-secret-2026') {
    return corsResponse(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json() as any;
  const label = body.label || 'unknown';
  const tunnelUrl = body.tunnelUrl || '';
  const now = Date.now();
  await env.EMBASSIES_DB.prepare(
    'INSERT OR REPLACE INTO embassies (label, tunnel_url, last_seen) VALUES (?, ?, ?)'
  ).bind(label, tunnelUrl, now).run();
  return corsResponse(JSON.stringify({ success: true }));
}

async function handleGetEmbassies(env: Env): Promise<Response> {
  const rows = await env.EMBASSIES_DB.prepare(
    'SELECT label, tunnel_url, last_seen FROM embassies WHERE last_seen > ?'
  ).bind(Date.now() - 5 * 60 * 1000).all();
  const result = rows.results.map((r: any) => ({
    label: r.label,
    tunnelUrl: r.tunnel_url,
    lastSeen: new Date(r.last_seen).toISOString()
  }));
  return corsResponse(JSON.stringify(result));
}

async function handleCommandPost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const command = body.command || '';
  const type = body.type || 'command';
  const method = body.method || 'GET';
  const path = body.path || '';
  const bodyData = body.body ? JSON.stringify(body.body) : '';
  const taskId = crypto.randomUUID();
  await env.EMBASSIES_DB.prepare(
    'INSERT INTO commands (id, command, type, method, path, body, status, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(taskId, command, type, method, path, bodyData, 'pending', '', Date.now()).run();
  return corsResponse(JSON.stringify({ success: true, taskId }));
}

async function handleCommandGet(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, status, result, created_at FROM commands WHERE id = ?'
  ).bind(taskId).first();
  if (!row) return corsResponse(JSON.stringify({ error: 'Not found' }), { status: 404 });
  return corsResponse(JSON.stringify(row));
}

async function handleCommandPatch(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const body = await request.json() as any;
  await env.EMBASSIES_DB.prepare(
    'UPDATE commands SET status = ?, result = ? WHERE id = ?'
  ).bind(body.status || 'completed', body.result || '', taskId).run();
  return corsResponse(JSON.stringify({ success: true }));
}

async function handleCommandPending(env: Env): Promise<Response> {
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, type, method, path, body, status, result, created_at FROM commands WHERE status = ? ORDER BY created_at ASC LIMIT 1'
  ).bind('pending').first();
  if (!row) return corsResponse(JSON.stringify({ pending: false }));
  return corsResponse(JSON.stringify({
    pending: true,
    taskId: row.id,
    command: row.command,
    type: row.type,
    method: row.method,
    path: row.path,
    body: row.body
  }));
}
interface Env {
  EMBASSIES_DB: D1Database;
  AUTH_WORKER_URL: string;
  GEMINI_API_KEY_1?: string;
  GEMINI_API_KEY_2?: string;
  GEMINI_API_KEY_3?: string;
  GEMINI_API_KEY_4?: string;
  GEMINI_API_KEY_5?: string;
  GEMINI_API_KEY_6?: string;
  GEMINI_API_KEY_7?: string;
  GEMINI_API_KEY_8?: string;
  GEMINI_API_KEY_9?: string;
  GEMINI_API_KEY_10?: string;
  GEMINI_API_KEY_11?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embassy-Secret',
};

function corsResponse(body: BodyInit | null, init?: ResponseInit): Response {
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  return new Response(body, { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, { status: 204 });
    }

    // Health check
    if (path === '/health') return new Response('OK');

    // Embassy endpoints
    if (path === '/register-embassy' && request.method === 'POST') {
      return handleRegisterEmbassy(request, env);
    }
    if (path === '/get-active-embassies') {
      return handleGetEmbassies(env);
    }

    // Command queue endpoints
    if (path === '/command' && request.method === 'POST') {
      return handleCommandPost(request, env);
    }
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'GET') {
      return handleCommandGet(request, env, path);
    }
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'PATCH') {
      return handleCommandPatch(request, env, path);
    }
    if (path === '/command/pending' && request.method === 'GET') {
      return handleCommandPending(env);
    }

    
  // Gemini relay endpoint (uses Worker secrets)
  if (path === '/gemini/complete' && request.method === 'POST') {
    const body = await request.json() as any;
    const prompt = body.prompt || '';
    const keys = [
      env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3,
      env.GEMINI_API_KEY_4, env.GEMINI_API_KEY_5, env.GEMINI_API_KEY_6,
      env.GEMINI_API_KEY_7, env.GEMINI_API_KEY_8, env.GEMINI_API_KEY_9,
      env.GEMINI_API_KEY_10, env.GEMINI_API_KEY_11
    ].filter(Boolean);

    if (keys.length === 0) return corsResponse(JSON.stringify({ error: 'No Gemini keys configured' }), { status: 500 });

    let lastError = null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const geminiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }]
            })
          }
        );
        const data = await geminiResp.json() as any;
        if (data.error) {
          lastError = data.error;
          continue;
        }
        return corsResponse(JSON.stringify({ text: data.candidates[0].content.parts[0].text }));
      } catch (err) {
        lastError = err;
      }
    }
    return corsResponse(JSON.stringify({ error: `All keys exhausted: ${lastError?.message || 'unknown'}` }), { status: 502 });
  }

  return corsResponse('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    await env.EMBASSIES_DB.prepare(
      'DELETE FROM embassies WHERE last_seen < ?'
    ).bind(fiveMinutesAgo).run();
  }
};

async function handleRegisterEmbassy(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get('X-Embassy-Secret') || '';
  if (secret !== 'vongstaad-embassy-secret-2026') {
    return corsResponse(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json() as any;
  const label = body.label || 'unknown';
  const tunnelUrl = body.tunnelUrl || '';
  const now = Date.now();
  await env.EMBASSIES_DB.prepare(
    'INSERT OR REPLACE INTO embassies (label, tunnel_url, last_seen) VALUES (?, ?, ?)'
  ).bind(label, tunnelUrl, now).run();
  return corsResponse(JSON.stringify({ success: true }));
}

async function handleGetEmbassies(env: Env): Promise<Response> {
  const rows = await env.EMBASSIES_DB.prepare(
    'SELECT label, tunnel_url, last_seen FROM embassies WHERE last_seen > ?'
  ).bind(Date.now() - 5 * 60 * 1000).all();
  const result = rows.results.map((r: any) => ({
    label: r.label,
    tunnelUrl: r.tunnel_url,
    lastSeen: new Date(r.last_seen).toISOString()
  }));
  return corsResponse(JSON.stringify(result));
}

async function handleCommandPost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const command = body.command || '';
  const type = body.type || 'command';
  const method = body.method || 'GET';
  const path = body.path || '';
  const bodyData = body.body ? JSON.stringify(body.body) : '';
  const taskId = crypto.randomUUID();
  await env.EMBASSIES_DB.prepare(
    'INSERT INTO commands (id, command, type, method, path, body, status, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(taskId, command, type, method, path, bodyData, 'pending', '', Date.now()).run();
  return corsResponse(JSON.stringify({ success: true, taskId }));
}

async function handleCommandGet(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, status, result, created_at FROM commands WHERE id = ?'
  ).bind(taskId).first();
  if (!row) return corsResponse(JSON.stringify({ error: 'Not found' }), { status: 404 });
  return corsResponse(JSON.stringify(row));
}

async function handleCommandPatch(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const body = await request.json() as any;
  await env.EMBASSIES_DB.prepare(
    'UPDATE commands SET status = ?, result = ? WHERE id = ?'
  ).bind(body.status || 'completed', body.result || '', taskId).run();
  return corsResponse(JSON.stringify({ success: true }));
}

async function handleCommandPending(env: Env): Promise<Response> {
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, type, method, path, body, status, result, created_at FROM commands WHERE status = ? ORDER BY created_at ASC LIMIT 1'
  ).bind('pending').first();
  if (!row) return corsResponse(JSON.stringify({ pending: false }));
  return corsResponse(JSON.stringify({
    pending: true,
    taskId: row.id,
    command: row.command,
    type: row.type,
    method: row.method,
    path: row.path,
    body: row.body
  }));
}


// ── In‑memory task queue (for dashboard ⇄ local relay) ──────
const tasks = new Map();

// POST /command – create a new task
async function handleCreateCommand(request) {
  const body = await request.json();
  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    type: body.type || 'command',
    command: body.command || '',
    method: body.method || '',
    path: body.path || '',
    body: body.body || null,
    status: 'pending',
    result: '',
    createdAt: Date.now()
  };
  tasks.set(taskId, task);
  return new Response(JSON.stringify({ success: true, taskId }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /command/:id – retrieve task status
function handleGetCommand(taskId) {
  const task = tasks.get(taskId);
  if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify(task), { headers: { 'Content-Type': 'application/json' } });
}

// PATCH /command/:id – update task (used by poll‑worker)
async function handlePatchCommand(taskId, request) {
  const body = await request.json();
  const task = tasks.get(taskId);
  if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  task.status = body.status || task.status;
  task.result = body.result || task.result;
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /command/pending – get the oldest pending task (for poll‑worker)
function handlePendingCommand() {
  let oldest = null;
  for (const task of tasks.values()) {
    if (task.status === 'pending') {
      if (!oldest || task.createdAt < oldest.createdAt) oldest = task;
    }
  }
  if (!oldest) return new Response(JSON.stringify({ pending: false }), { headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ pending: true, taskId: oldest.id, type: oldest.type, command: oldest.command, method: oldest.method, path: oldest.path, body: oldest.body }), { headers: { 'Content-Type': 'application/json' } });
}
