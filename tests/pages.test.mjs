// Offline checks for the two single-file pages: the public app and the Valeria artifact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const app = read('app/index.html');
const valeria = read('valeria/valeria.html');
const scripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test('every inline script parses', () => {
  for (const [name, html] of [['app', app], ['valeria', valeria]]) {
    const s = scripts(html);
    assert.ok(s.length >= 1, `${name} has a script`);
    s.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code), `${name} script ${i}`));
  }
});

test('the app loads nothing from other sites and has a strict CSP', () => {
  assert.match(app, /http-equiv="Content-Security-Policy"[^>]*connect-src 'none'/);
  assert.doesNotMatch(app, /<(script|link|img|iframe)[^>]+(src|href)="https?:/i);
  const urls = [...app.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(urls)], ['https://claude.ai/artifact/1VNEHA36ErLWfcv7hjbzDD']);
});

test('the app and Valeria point at each other', () => {
  const valeriaUrl = /valeriaUrl:"([^"]+)"/.exec(app)[1];
  const appUrl = /appUrl: "([^"]+)"/.exec(valeria)[1];
  assert.match(valeriaUrl, /^https:\/\/claude\.ai\/artifact\//);
  assert.equal(appUrl, 'https://leftbrain847.github.io/habla/');
});

test('no personal data ships', () => {
  for (const word of ['italki', 'BaseLang', 'B2 push', 'jimtitus', '@gmail']) {
    assert.ok(!app.includes(word), `app contains ${word}`);
    assert.ok(!valeria.includes(word), `valeria contains ${word}`);
  }
  assert.match(app, /var SEED_SESSIONS=\[\];/);
});

test('Valeria grammar targets match the app', () => {
  const ids = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
  const appIds = ids(app, /"id":"((?:c\d|ag)-\d+)"/g);
  const valIds = ids(valeria, /"id":"((?:c\d|ag)-\d+)"/g);
  assert.equal(appIds.length, 67);
  assert.deepEqual(valIds, appIds);
});
