// Offline smoke tests: every script parses, and the server only answers localhost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3999;
let server;

function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
}

function request(path, { method = 'GET', host = `localhost:${PORT}`, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), CLAUDE_BIN: 'habla-test-no-claude' } });
  for (let i = 0; i < 50; i++) {
    try { await request('/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => server?.kill());

test('every script parses', () => {
  const files = jsFiles(root).filter((f) => !f.includes(`${join('tests')}`));
  assert.ok(files.length >= 8, `found ${files.length} scripts`);
  for (const f of files) execFileSync(process.execPath, ['--check', f]);
});

test('serves the app on localhost', async () => {
  assert.equal(await request('/'), 200);
});

test('refuses any other Host header (DNS rebinding)', async () => {
  assert.equal(await request('/', { host: 'evil.example' }), 403);
});

test('refuses a POST from another site', async () => {
  assert.equal(await request('/api/chat', { method: 'POST', origin: 'https://evil.example' }), 403);
});
