// Alternatives to Claude Code. Both take the full history each turn because
// neither keeps state between requests.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

export async function ollamaChat({ model, systemPrompt, history, text, onDelta }) {
  const startedAt = Date.now();
  let firstTokenAt = null;
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }],
    }),
  }).catch(() => {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}. Is it running?`);
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);

  let full = '';
  for await (const line of ndjsonLines(res.body)) {
    const event = JSON.parse(line);
    if (event.error) throw new Error(`Ollama: ${event.error}`);
    const delta = event.message?.content || '';
    if (delta) {
      if (!firstTokenAt) firstTokenAt = Date.now();
      full += delta;
      onDelta(delta);
    }
  }
  return { text: full, firstTokenMs: firstTokenAt && firstTokenAt - startedAt, totalMs: Date.now() - startedAt };
}

export async function anthropicChat({ model, systemPrompt, history, text, onDelta }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set. Set it before running npm start to use the API provider.');
  const startedAt = Date.now();
  let firstTokenAt = null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      stream: true,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);

  let full = '';
  for await (const line of ndjsonLines(res.body)) {
    if (!line.startsWith('data:')) continue;
    const event = JSON.parse(line.slice(5));
    if (event.type === 'error') throw new Error(`Anthropic API: ${event.error?.message}`);
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      if (!firstTokenAt) firstTokenAt = Date.now();
      full += event.delta.text;
      onDelta(event.delta.text);
    }
  }
  return { text: full, firstTokenMs: firstTokenAt && firstTokenAt - startedAt, totalMs: Date.now() - startedAt };
}

async function* ndjsonLines(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}
