export class GeminiAdapter {
  private apiKeys: string[];
  private model: string;
  private currentKeyIndex = 0;

  constructor(apiKeys: string[], model = 'gemini-2.5-flash') {
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
