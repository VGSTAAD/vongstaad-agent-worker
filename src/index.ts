import { GeminiAdapter } from './adapters/gemini';
import { Env } from './types';

function getKeys(env: Env): string[] {
  return [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY_4,
          env.GEMINI_API_KEY_5, env.GEMINI_API_KEY_6, env.GEMINI_API_KEY_7, env.GEMINI_API_KEY_8,
          env.GEMINI_API_KEY_9, env.GEMINI_API_KEY_10, env.GEMINI_API_KEY_11];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('OK', { status: 200 });
    if (url.pathname === '/agent-loop' && request.method === 'POST') return handleAgentLoop(request, env);
    if (url.pathname === '/auto-review' && request.method === 'POST') return handleAutoReview(request, env);
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const gemini = new GeminiAdapter(getKeys(env), 'gemini-3-flash-preview');
    const messages = [
      { role: 'system', text: 'You are a Code Reviewer. Review the latest institutional state and report any concerns.' },
      { role: 'user', text: 'Run a health check on the institution.' }
    ];
    const result = await gemini.complete('CodeReviewer', messages);
    console.log('Autonomous review completed:', result);
  }
};

async function handleAgentLoop(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const gemini = new GeminiAdapter(getKeys(env), 'gemini-3-flash-preview');
  const messages: Array<{ role: string; text: string }> = [
    { role: 'system', text: body.task || 'Review the institution' }
  ];
  const agents = body.agents || [{ name: 'DevBot' }, { name: 'ReviewerBot' }];
  const maxTurns = body.maxTurns || 4;
  
  for (let i = 0; i < maxTurns; i++) {
    const agent = agents[i % agents.length];
    const reply = await gemini.complete(agent.name, messages);
    messages.push({ role: agent.name, text: reply });
  }
  
  return new Response(JSON.stringify({ success: true, messages }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleAutoReview(request: Request, env: Env): Promise<Response> {
  const gemini = new GeminiAdapter(getKeys(env), 'gemini-3-flash-preview');
  const messages = [
    { role: 'system', text: 'You are a Code Reviewer. Review the latest institutional state and report any concerns.' },
    { role: 'user', text: 'Run a health check on the institution.' }
  ];
  const result = await gemini.complete('CodeReviewer', messages);
  return new Response(JSON.stringify({ success: true, result }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
