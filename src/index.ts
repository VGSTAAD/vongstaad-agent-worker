// ── Vongstaad Agent Worker – Command Relay & Agent Loop ────────
interface Env {
  GEMINI_API_KEY_1: string;
  GEMINI_API_KEY_2: string;
  GEMINI_API_KEY_3: string;
  GEMINI_API_KEY_4: string;
  GEMINI_API_KEY_5: string;
  GEMINI_API_KEY_6: string;
  GEMINI_API_KEY_7: string;
  GEMINI_API_KEY_8: string;
  GEMINI_API_KEY_9: string;
  GEMINI_API_KEY_10: string;
  GEMINI_API_KEY_11: string;
  ADMIN_SECRET: string;
  AUTH_WORKER_URL: string;
  AGENT_ROOMS: KVNamespace;
}

function getKeys(env: Env): string[] {
  return [
    env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4, env.GEMINI_API_KEY_5, env.GEMINI_API_KEY_6,
    env.GEMINI_API_KEY_7, env.GEMINI_API_KEY_8, env.GEMINI_API_KEY_9,
    env.GEMINI_API_KEY_10, env.GEMINI_API_KEY_11
  ];
}

// ── In‑memory task queue ───────────────────────────────────
const tasks = new Map<string, any>();

async function handleCreateCommand(request: Request) {
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

function handleGetCommand(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify(task), { headers: { 'Content-Type': 'application/json' } });
}

async function handlePatchCommand(taskId: string, request: Request) {
  const body = await request.json();
  const task = tasks.get(taskId);
  if (!task) return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  task.status = body.status || task.status;
  task.result = body.result || task.result;
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

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

// ── Gemini adapter ─────────────────────────────────────────
class GeminiAdapter {
  private apiKeys: string[];
  private model: string;
  private currentKeyIndex = 0;

  constructor(apiKeys: string[], model = 'gemini-3-flash-preview') {
    this.apiKeys = apiKeys.filter(Boolean);
    this.model = model;
  }

  async complete(agentName: string, history: Array<{ role: string; text: string }>): Promise<string> {
    const contents = history.map(m => ({
      role: 'user',
      parts: [{ text: `[${m.role}]: ${m.text}` }]
    }));

    let lastError: any = null;
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      const key = this.apiKeys[this.currentKeyIndex];
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
          }
        );
        const data = await response.json() as any;
        if (data.error) {
          lastError = data.error;
          this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
          continue;
        }
        return data.candidates[0].content.parts[0].text;
      } catch (err) {
        lastError = err;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      }
    }
    return `[${agentName}] Error: ${lastError?.message || 'All keys exhausted'}`;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') return new Response('OK', { status: 200 });

    // Command endpoints (for dashboard relay)
    const commandMatch = url.pathname.match(/^\/command\/([a-f0-9-]+)$/);
    if (commandMatch) {
      const taskId = commandMatch[1];
      if (request.method === 'GET') return handleGetCommand(taskId);
      if (request.method === 'PATCH') return handlePatchCommand(taskId, request);
    }
    if (url.pathname === '/command' && request.method === 'POST') return handleCreateCommand(request);
    if (url.pathname === '/command/pending' && request.method === 'GET') return handlePendingCommand();

    return new Response('Not Found', { status: 404 });
  }
};
