// Bridge to a long-lived Claude Code process in streaming JSON mode.
// One process holds one conversation, so Claude remembers earlier turns and
// we avoid paying the start-up cost on every reply. Uses the user's own
// Claude Code login (their subscription); no API key involved.

import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const TURN_TIMEOUT_MS = 120_000;

// Work out how to launch `claude`. The native Windows installer puts
// claude.exe in %USERPROFILE%\.local\bin, which may not be on PATH yet.
export function resolveClaudeCommand() {
  if (process.env.CLAUDE_BIN) return { cmd: process.env.CLAUDE_BIN, shell: false };
  if (process.platform === 'win32') {
    const native = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
    if (existsSync(native)) return { cmd: native, shell: false };
    // npm installs ship claude.cmd, which needs a shell to run on Windows.
    return { cmd: 'claude', shell: true };
  }
  return { cmd: 'claude', shell: false };
}

export function claudeVersion() {
  const { cmd, shell } = resolveClaudeCommand();
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { shell, windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

export class ClaudeCodeSession {
  constructor({ model, systemPrompt }) {
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.proc = null;
    this.turn = null; // { onDelta, resolve, reject, timer, firstTokenAt, startedAt }
    this.queue = Promise.resolve();
    this.stderr = '';
  }

  start() {
    if (this.proc) return;
    // Run in an empty folder of our own so no project files or CLAUDE.md
    // are ever in reach, and the prompt file has somewhere to live.
    const dir = path.join(os.tmpdir(), 'habla-claude');
    mkdirSync(dir, { recursive: true });
    const promptFile = path.join(dir, 'system-prompt.txt');
    writeFileSync(promptFile, this.systemPrompt, 'utf8');

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--tools', '', // no tools: it can only talk, never touch the PC
      '--system-prompt-file', promptFile,
      '--safe-mode', // skip user CLAUDE.md, plugins, hooks, MCP servers
      '--strict-mcp-config',
      '--no-session-persistence',
      '--model', this.model,
    ];
    const { cmd, shell } = resolveClaudeCommand();
    const proc = spawn(cmd, shell ? args.map(quoteForCmd) : args, {
      cwd: dir,
      shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.stderr = '';

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.#onLine(line));
    proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    proc.on('error', (err) => this.#fail(new Error(`Could not start Claude Code (${err.message}). Is it installed and on PATH?`)));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      const detail = this.stderr.trim().split('\n').slice(-3).join(' ');
      this.#fail(new Error(`Claude Code exited (code ${code}). ${detail}`.trim()));
    });
  }

  // Send one user message; onDelta receives text as it streams.
  // Turns are serialized: a second call waits for the first to finish.
  send(text, onDelta) {
    const run = () => new Promise((resolve, reject) => {
      this.start();
      const timer = setTimeout(() => this.#fail(new Error('Claude Code took too long to answer.')), TURN_TIMEOUT_MS);
      this.turn = { onDelta, resolve, reject, timer, startedAt: Date.now(), firstTokenAt: null, text: '' };
      const msg = { type: 'user', message: { role: 'user', content: text } };
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdin.end();
      proc.kill();
    }
  }

  #onLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return; // ignore non-JSON noise
    }
    const turn = this.turn;
    if (!turn) return;
    if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') {
      const delta = event.event.delta.text;
      if (!turn.firstTokenAt) turn.firstTokenAt = Date.now();
      turn.text += delta;
      turn.onDelta(delta);
    } else if (event.type === 'result') {
      this.turn = null;
      clearTimeout(turn.timer);
      if (event.is_error) {
        turn.reject(new Error(String(event.result || event.subtype || 'Claude Code returned an error.')));
      } else {
        turn.resolve({
          text: turn.text,
          firstTokenMs: turn.firstTokenAt ? turn.firstTokenAt - turn.startedAt : null,
          totalMs: Date.now() - turn.startedAt,
        });
      }
    }
  }

  #fail(err) {
    const turn = this.turn;
    this.turn = null;
    if (turn) {
      clearTimeout(turn.timer);
      turn.reject(err);
    }
    if (err.message.includes('took too long')) this.stop();
  }
}

// Only used for the npm (claude.cmd) fallback, where args go through cmd.exe.
function quoteForCmd(arg) {
  if (arg === '') return '""';
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
