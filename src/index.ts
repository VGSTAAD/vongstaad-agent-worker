interface Env {
  EMBASSIES_DB: D1Database;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Embassy-Secret',
};

function cors(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return cors(null, { status: 204 });
    if (path === '/health') return cors(JSON.stringify({ status: 'ok' }));

    if (path === '/command' && request.method === 'POST') return handleCommandPost(request, env);
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'GET') return handleCommandGet(request, env, path);
    if (path.startsWith('/command/') && !path.endsWith('/pending') && request.method === 'PATCH') return handleCommandPatch(request, env, path);
    if (path === '/command/pending' && request.method === 'GET') return handleCommandPending(env);

    return cors('Not Found', { status: 404 });
  }
};

async function handleCommandPost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const taskId = crypto.randomUUID();
  await env.EMBASSIES_DB.prepare(
    'INSERT INTO commands (id, command, status, result, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(taskId, JSON.stringify(body), 'pending', '', Date.now()).run();
  return cors(JSON.stringify({ success: true, taskId }));
}

async function handleCommandGet(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const row = await env.EMBASSIES_DB.prepare('SELECT id, command, status, result, created_at FROM commands WHERE id = ?').bind(taskId).first();
  if (!row) return cors(JSON.stringify({ error: 'Not found' }), { status: 404 });
  let commandObj;
  try { commandObj = JSON.parse(row.command as string); } catch { commandObj = row.command; }
  return cors(JSON.stringify({ id: row.id, command: commandObj, status: row.status, result: row.result, created_at: row.created_at }));
}

async function handleCommandPatch(request: Request, env: Env, path: string): Promise<Response> {
  const taskId = path.split('/').pop()!;
  const body = await request.json() as any;
  await env.EMBASSIES_DB.prepare('UPDATE commands SET status = ?, result = ? WHERE id = ?').bind(body.status || 'completed', body.result || '', taskId).run();
  return cors(JSON.stringify({ success: true }));
}

async function handleCommandPending(env: Env): Promise<Response> {
  const row = await env.EMBASSIES_DB.prepare('SELECT id, command, status, result, created_at FROM commands WHERE status = ? ORDER BY created_at ASC LIMIT 1').bind('pending').first();
  if (!row) return cors(JSON.stringify({ pending: false }));
  let commandObj;
  try { commandObj = JSON.parse(row.command as string); } catch { commandObj = row.command; }
  return cors(JSON.stringify({ pending: true, taskId: row.id, command: commandObj, created_at: row.created_at }));
}
