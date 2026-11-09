// Habla local server: serves the app and relays conversation turns to the
// chosen model. Listens on 127.0.0.1 only, so nothing else on the network
// can reach it.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeSession, claudeVersion } from './lib/claude-code.js';
import { ollamaChat, anthropicChat } from './lib/providers.js';
import { buildSystemPrompt, KICKOFF, LEVEL_KEYS } from './lib/prompt.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const CLAUDE_MODELS = new Set(['haiku', 'sonnet', 'opus']);

// One Claude Code conversation at a time; replaced when settings change.
let session = null;
let sessionKey = '';

function getSession(model, level) {
  const key = `${model}|${level}`;
  if (session && sessionKey === key) return session;
  session?.stop();
  session = new ClaudeCodeSession({ model, systemPrompt: buildSystemPrompt(level) });
  sessionKey = key;
  session.start();
  return session;
}

function resetSession() {
  session?.stop();
  session = null;
  sessionKey = '';
}

async function handleChat(req, res) {
  const body = await readJson(req);
  const provider = body.provider || 'claude-code';
  const level = LEVEL_KEYS.includes(body.level) ? body.level : 'A2-B1';
  const text = body.kickoff ? KICKOFF : String(body.text || '').slice(0, 4000);
  const history = Array.isArray(body.history) ? body.history.slice(-40) : [];
  if (!text.trim()) return sendJson(res, 400, { error: 'Empty message.' });

  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  const onDelta = (delta) => res.write(delta);

  try {
    let result;
    if (provider === 'claude-code') {
      const model = CLAUDE_MODELS.has(body.model) ? body.model : 'sonnet';
      result = await getSession(model, level).send(text, onDelta);
    } else if (provider === 'ollama') {
      result = await ollamaChat({ model: body.model || 'gemma3:12b', systemPrompt: buildSystemPrompt(level), history, text, onDelta });
    } else if (provider === 'api') {
      result = await anthropicChat({ model: body.model || 'claude-sonnet-5-5', systemPrompt: buildSystemPrompt(level), history, text, onDelta });
    } else {
      throw new Error(`Unknown provider "${provider}".`);
    }
    console.log(`[turn] ${provider}/${body.model || 'default'}  first token ${fmt(result.firstTokenMs)}  total ${fmt(result.totalMs)}`);
    // Trailer line the browser strips off; carries server-side timing.
    res.end(`\u0000${JSON.stringify({ firstTokenMs: result.firstTokenMs, totalMs: result.totalMs })}`);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    res.end(`\u0000${JSON.stringify({ error: err.message })}`);
  }
}

async function handleStatus(res) {
  const version = await claudeVersion();
  sendJson(res, 200, {
    claudeCode: { available: Boolean(version), version },
    apiKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  // Block other websites from driving this server through your browser:
  // only same-origin requests addressed to localhost are accepted.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return sendJson(res, 403, { error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) {
    return sendJson(res, 403, { error: 'Forbidden origin' });
  }

  try {
    if (req.method === 'POST' && req.url === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && req.url === '/api/reset') {
      resetSession();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/warm') {
      // A page load means a new conversation: drop the old one and boot a
      // fresh Claude Code ahead of the first turn so it answers sooner.
      const body = await readJson(req);
      const model = CLAUDE_MODELS.has(body.model) ? body.model : 'sonnet';
      const level = LEVEL_KEYS.includes(body.level) ? body.level : 'A2-B1';
      resetSession();
      getSession(model, level);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/status') return await handleStatus(res);
    if (req.method === 'GET') return await serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`\n  Habla is running at http://localhost:${PORT}\n  Open it in Edge. Press Ctrl+C to stop.\n`);
  const version = await claudeVersion();
  console.log(version ? `  Claude Code found: ${version}` : '  Claude Code not found. Install it, or pick Ollama/API in settings.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Close the other Habla window, or run with PORT=3001.`);
  else console.error(err);
  process.exit(1);
});

process.on('SIGINT', () => {
  session?.stop();
  process.exit(0);
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function fmt(ms) {
  return ms == null ? '-' : `${(ms / 1000).toFixed(2)}s`;
}
