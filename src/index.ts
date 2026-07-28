interface Env {
  EMBASSIES_DB: D1Database;
  AUTH_WORKER_URL: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embassy-Secret',
};

function cors(body: BodyInit | null, init?: ResponseInit): Response {
  const headers = { ...CORS_HEADERS, ...(init?.headers || {}) };
  if (typeof body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  return new Response(body, {
    ...init,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return cors(null, { status: 204 });
    if (path === '/health') return cors(JSON.stringify({ status: 'ok' }));

    // Embassy endpoints
    if (path === '/register-embassy' && request.method === 'POST') return handleRegisterEmbassy(request, env);
    if (path === '/get-active-embassies') return handleGetEmbassies(env);

    // Command queue endpoints
    if (path === '/command' && request.method === 'POST') return handleCommandPost(request, env);
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'GET') return handleCommandGet(request, env, path);
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'PATCH') return handleCommandPatch(request, env, path);
    if (path === '/command/pending' && request.method === 'GET') return handleCommandPending(env);

    return cors('Not Found', { status: 404 });
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
  if (secret !== 'vongstaad-embassy-secret-2026')
    return cors(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 });
  const body = await request.json() as any;
  const label = body.label || 'unknown';
  const tunnelUrl = body.tunnelUrl || '';
  const now = Date.now();
  await env.EMBASSIES_DB.prepare(
    'INSERT OR REPLACE INTO embassies (label, tunnel_url, last_seen) VALUES (?, ?, ?)'
  ).bind(label, tunnelUrl, now).run();
  return cors(JSON.stringify({ success: true }));
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
  return cors(JSON.stringify(result));
}

async function handleCommandPost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const taskId = crypto.randomUUID();
  // Store the body as a native JSON object – not a string
  const commandJson = JSON.stringify(body); // This is the whole task (type, method, path, etc.)
  await env.EMBASSIES_DB.prepare(
    'INSERT INTO commands (id, command, status, result, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(taskId, commandJson, 'pending', '', Date.now()).run();
  return cors(JSON.stringify({ success: true, taskId }));
}

async function handleCommandGet(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, status, result, created_at FROM commands WHERE id = ?'
  ).bind(taskId).first();
  if (!row) return cors(JSON.stringify({ error: 'Not found' }), { status: 404 });
  // Return the command as a parsed JSON object (so the poll-worker receives a plain object)
  let commandObj;
  try {
    commandObj = JSON.parse(row.command as string);
  } catch {
    commandObj = row.command;
  }
  return cors(JSON.stringify({
    id: row.id,
    command: commandObj,
    status: row.status,
    result: row.result,
    created_at: row.created_at
  }));
}

async function handleCommandPatch(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const body = await request.json() as any;
  await env.EMBASSIES_DB.prepare(
    'UPDATE commands SET status = ?, result = ? WHERE id = ?'
  ).bind(body.status || 'completed', body.result || '', taskId).run();
  return cors(JSON.stringify({ success: true }));
}

async function handleCommandPending(env: Env): Promise<Response> {
  const row = await env.EMBASSIES_DB.prepare(
    'SELECT id, command, status, result, created_at FROM commands WHERE status = ? ORDER BY created_at ASC LIMIT 1'
  ).bind('pending').first();
  if (!row) return cors(JSON.stringify({ pending: false }));
  let commandObj;
  try {
    commandObj = JSON.parse(row.command as string);
  } catch {
    commandObj = row.command;
  }
  return cors(JSON.stringify({ pending: true, taskId: row.id, command: commandObj }));
}
