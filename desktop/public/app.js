// Habla turn loop: listen → transcribe → Claude → speak → listen again.

import { Microphone } from './audio.js';
import { EdgeRecognizer, edgeRecognitionAvailable } from './stt-edge.js';
import { Speaker, listSpanishVoices, voicesReady } from './tts.js';

const $ = (id) => document.getElementById(id);

// ---------- Settings ----------

const DEFAULTS = {
  level: 'A2-B1',
  provider: 'claude-code',
  claudeModel: 'sonnet',
  ollamaModel: 'gemma3:12b',
  apiModel: 'claude-sonnet-5-5',
  stt: 'whisper',
  whisperModel: 'onnx-community/whisper-base',
  pauseMs: 1200,
  sensitivity: 1,
  voiceURI: '',
  rate: 0.95,
  showLatency: true,
};

const settings = { ...DEFAULTS, ...loadSettings() };

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('habla-settings') || '{}');
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    localStorage.setItem('habla-settings', JSON.stringify(settings));
  } catch {}
}

// ---------- State ----------

const STATUS_TEXT = {
  idle: 'Not started',
  loading: 'Loading…',
  listening: 'Escuchando',
  hearing: 'Escuchando',
  transcribing: 'Transcribiendo…',
  thinking: 'Pensando…',
  speaking: 'Hablando',
  paused: 'Mic paused',
  error: 'Problem',
};
const HINTS = {
  listening: 'Speak in Spanish. Pause when you finish and Valeria will answer.',
  hearing: 'Listening… pause when you\'re done.',
  transcribing: 'Turning your speech into text…',
  thinking: 'Valeria is thinking…',
  speaking: 'Valeria is talking. Press Esc to cut her off.',
  paused: 'Mic is paused. Type below, or resume the mic.',
};

let state = 'idle';
let started = false;
let micPaused = false;
let history = []; // [{role, content}] for providers that need it
let mic = null;
let edge = null;
let worker = null;
let whisperReady = null; // Promise while loading
let turnTimes = null; // timing for the current turn
let interimEl = null;
const envInfo = {}; // diagnostics lines shown in Settings

function setEnvInfo(key, text) {
  envInfo[key] = text;
  $('envInfo').textContent = Object.values(envInfo).filter(Boolean).join(' ');
}

const speaker = new Speaker({
  onStart: (t) => {
    if (turnTimes) turnTimes.firstAudio = t;
    setState('speaking');
  },
  onIdle: () => {
    showLatency();
    resumeListening();
  },
});

function setState(next) {
  state = next;
  $('status').dataset.state = next;
  $('status').textContent = STATUS_TEXT[next] || next;
  $('orb').dataset.state = next;
  if (HINTS[next]) $('hint').textContent = HINTS[next];
  const busy = ['transcribing', 'thinking', 'speaking', 'loading'].includes(next);
  $('textInput').disabled = !started || busy;
  $('sendBtn').disabled = !started || busy;
  $('skipBtn').disabled = next !== 'speaking';
  $('pauseBtn').disabled = !started;
  $('pauseBtn').textContent = micPaused ? 'Resume mic' : 'Pause mic';
}

function setMicActive(on) {
  if (settings.stt === 'whisper') mic?.setActive(on);
  else edge?.setActive(on);
  if (mic) mic.active = on; // drives the level meter for either engine
}

function resumeListening() {
  if (!started) return;
  if (micPaused) {
    setMicActive(false);
    setState('paused');
  } else {
    setMicActive(true);
    setState('listening');
  }
}

// ---------- Transcript ----------

function addMessage(role, text, extraClass = '') {
  $('intro')?.remove();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role} ${extraClass}`.trim();
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'partner' ? 'Valeria' : 'You';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.append(who, bubble);
  $('transcript').append(wrap);
  scrollDown();
  return wrap;
}

function addDivider(text) {
  const d = document.createElement('div');
  d.className = 'divider';
  d.textContent = text;
  $('transcript').append(d);
  scrollDown();
}

function addMeta(el, text) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = text;
  el.append(meta);
}

function scrollDown() {
  const t = $('transcript');
  t.scrollTop = t.scrollHeight;
}

function showNotice(html) {
  $('notice').innerHTML = html;
  $('notice').hidden = !html;
}

// ---------- Talking to the model ----------

async function sendTurn({ text, kickoff = false }) {
  setMicActive(false);
  setState('thinking');
  turnTimes = turnTimes || {};
  turnTimes.requestAt = performance.now();

  const bubbleWrap = addMessage('partner', '');
  const bubble = bubbleWrap.querySelector('.bubble');
  speaker.beginReply();

  const provider = settings.provider;
  const model = provider === 'claude-code' ? settings.claudeModel : provider === 'ollama' ? settings.ollamaModel : settings.apiModel;

  let reply = '';
  let trailer = null;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, level: settings.level, text, kickoff, history }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const nul = raw.indexOf('\u0000');
      const visible = nul >= 0 ? raw.slice(0, nul) : raw;
      if (visible.length > reply.length) {
        const delta = visible.slice(reply.length);
        if (!turnTimes.firstToken) turnTimes.firstToken = performance.now();
        reply = visible;
        bubble.textContent = reply;
        speaker.push(delta);
        scrollDown();
      }
      if (nul >= 0) trailer = raw.slice(nul + 1);
    }
    if (trailer) {
      const info = JSON.parse(trailer);
      if (info.error) throw new Error(info.error);
    }
  } catch (err) {
    speaker.stop();
    bubbleWrap.classList.add('error');
    bubble.textContent = reply ? `${reply}\n\n${err.message}` : err.message;
    explainError(err.message);
    turnTimes = null;
    resumeListening();
    return;
  }

  if (!reply.trim()) {
    bubbleWrap.remove();
    speaker.stop();
    resumeListening();
    return;
  }
  if (kickoff) history.push({ role: 'user', content: '[start]' });
  else history.push({ role: 'user', content: text });
  history.push({ role: 'assistant', content: reply });
  speaker.endReply(); // onIdle → resumeListening once she's done talking
}

function explainError(message) {
  if (/Could not start Claude Code|ENOENT/i.test(message)) {
    showNotice('<strong>Claude Code didn\'t start.</strong> Make sure <code>claude --version</code> works in a new terminal, then restart Habla. You can also pick another model source in Settings.');
  } else if (/log ?in|auth|credential|401/i.test(message)) {
    showNotice('<strong>Claude Code isn\'t signed in.</strong> Run <code>claude</code> in a terminal once, sign in, type <code>/exit</code>, then restart Habla.');
  } else if (/rate|limit|usage/i.test(message)) {
    showNotice('<strong>Usage limit reached</strong> on your Claude plan. Try again later, or switch to Ollama in Settings.');
  }
}

function handleUserText(text, { sttMs = null, speechEndAt = null } = {}) {
  text = text.trim();
  if (!text || ['thinking', 'speaking'].includes(state)) return;
  if (interimEl) {
    interimEl.remove();
    interimEl = null;
  }
  const el = addMessage('you', text);
  turnTimes = { speechEnd: speechEndAt ?? performance.now(), sttMs };
  if (sttMs != null && settings.showLatency) addMeta(el, `heard in ${(sttMs / 1000).toFixed(1)}s`);
  sendTurn({ text });
}

function showLatency() {
  const t = turnTimes;
  turnTimes = null;
  if (!t || !settings.showLatency) {
    $('latency').hidden = true;
    return;
  }
  const s = (a, b) => (a && b ? `${((b - a) / 1000).toFixed(2)}s` : '–');
  const parts = [];
  if (t.sttMs != null) parts.push(`speech→text ${(t.sttMs / 1000).toFixed(2)}s`);
  parts.push(`first word from Claude ${s(t.requestAt, t.firstToken)}`);
  parts.push(`first sound ${s(t.requestAt, t.firstAudio)}`);
  if (t.speechEnd) parts.push(`you stopped → she spoke ${s(t.speechEnd, t.firstAudio)}`);
  $('latency').textContent = parts.join('  ·  ');
  $('latency').hidden = false;
  console.log('[habla] turn timing', parts.join(' | '));
}

// ---------- Speech recognition ----------

const HALLUCINATIONS = /^(gracias( por ver( el video)?)?|subt[ií]tulos.*|.*amara\.org.*|suscr[ií]bete.*|¡?gracias!?|\.+|…)$/i;

function loadWhisper() {
  if (worker && whisperReady && worker.model === settings.whisperModel) return whisperReady;
  worker?.terminate();
  worker = new Worker('whisper-worker.js', { type: 'module' });
  worker.model = settings.whisperModel;
  const files = new Map();
  let nextId = 1;
  const pending = new Map();

  whisperReady = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        files.set(data.file, { loaded: data.loaded || 0, total: data.total || 0 });
        const loaded = [...files.values()].reduce((n, f) => n + f.loaded, 0);
        const total = [...files.values()].reduce((n, f) => n + f.total, 0);
        $('loadProgress').hidden = false;
        $('loadBar').style.width = `${total ? (loaded / total) * 100 : 0}%`;
        $('loadText').textContent = `Downloading Whisper… ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`;
      } else if (data.type === 'ready') {
        worker.device = data.device;
        setEnvInfo('whisper', `Whisper is running on ${data.device === 'webgpu' ? 'your GPU (WebGPU)' : 'your CPU (WebAssembly)'}.`);
        resolve();
      } else if (data.type === 'result' || data.type === 'error') {
        const p = pending.get(data.id);
        if (p) {
          pending.delete(data.id);
          data.type === 'result' ? p.resolve(data) : p.reject(new Error(data.message));
        } else if (data.type === 'error') {
          reject(new Error(data.message));
        }
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'Whisper failed to load.'));
  });
  worker.transcribe = (audio) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    });
  $('loadText').textContent = 'Preparing Whisper…';
  $('loadProgress').hidden = false;
  worker.postMessage({ type: 'load', model: settings.whisperModel });
  return whisperReady;
}

async function onWhisperUtterance(audio, endedAt) {
  setMicActive(false);
  setState('transcribing');
  try {
    const { text, ms } = await worker.transcribe(audio);
    if (interimEl) {
      interimEl.remove();
      interimEl = null;
    }
    if (!text || HALLUCINATIONS.test(text)) return resumeListening();
    handleUserText(text, { sttMs: ms, speechEndAt: endedAt });
  } catch (err) {
    showNotice(`<strong>Whisper error:</strong> ${escapeHtml(err.message)}`);
    resumeListening();
  }
}

function setupEdgeRecognizer() {
  if (edge) return;
  edge = new EdgeRecognizer({
    lang: 'es-MX',
    onInterim: (text) => {
      if (!text) return;
      setState('hearing');
      if (!interimEl) interimEl = addMessage('you', text, 'interim');
      else interimEl.querySelector('.bubble').textContent = text;
      scrollDown();
    },
    onUtterance: (text, endedAt) => {
      edge.setActive(false);
      handleUserText(text, { speechEndAt: endedAt });
    },
    onError: (msg) => showNotice(`<strong>${escapeHtml(msg)}</strong>`),
  });
  edge.pauseMs = settings.pauseMs;
}

// ---------- Start ----------

async function start() {
  $('startBtn').disabled = true;
  setState('loading');
  showNotice('');
  try {
    mic = new Microphone({
      onLevel: (level) => {
        $('orbRing').style.setProperty('--level', (1 + level * 0.6).toFixed(3));
      },
      onSpeechStart: () => setState('hearing'),
      onSpeechCancel: () => {
        if (state === 'hearing') setState('listening');
      },
      onUtterance: onWhisperUtterance,
    });
    mic.pauseMs = settings.pauseMs;
    mic.sensitivity = settings.sensitivity;
    await mic.start();
  } catch (err) {
    setState('error');
    $('startBtn').disabled = false;
    showNotice(`<strong>Couldn't use the microphone.</strong> ${escapeHtml(err.message)}. Click the lock icon in the address bar and allow the microphone, then try again.`);
    return;
  }

  if (settings.stt === 'whisper') {
    try {
      await loadWhisper();
    } catch (err) {
      // Fall back for this session only; Whisper is tried again next start.
      showNotice(`<strong>Whisper couldn't load</strong> (${escapeHtml(err.message)}). Using Edge's built-in recognition for now.`);
      settings.stt = 'edge';
      syncSettingsForm();
    }
  }
  if (settings.stt === 'edge') {
    if (!edgeRecognitionAvailable()) {
      setState('error');
      showNotice('<strong>No speech recognition available.</strong> Use Microsoft Edge, or type your messages.');
    } else {
      setupEdgeRecognizer();
    }
  }
  mic.captureUtterances = settings.stt === 'whisper';

  await voicesReady();
  applyVoice();
  $('loadProgress').hidden = true;
  started = true;
  $('orb').disabled = false;
  sendTurn({ kickoff: true });
}

// ---------- Controls ----------

$('startBtn').addEventListener('click', start);

$('pauseBtn').addEventListener('click', () => {
  micPaused = !micPaused;
  if (['listening', 'hearing', 'paused'].includes(state)) resumeListening();
  else setState(state);
});

$('orb').addEventListener('click', () => $('pauseBtn').click());

$('skipBtn').addEventListener('click', stopSpeaking);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state === 'speaking') stopSpeaking();
});
function stopSpeaking() {
  speaker.stop();
  showLatency();
  resumeListening();
}

$('textForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('textInput').value;
  $('textInput').value = '';
  handleUserText(text);
});

// ---------- Settings dialog ----------

function applyVoice() {
  const voices = listSpanishVoices();
  const select = $('voice');
  select.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    select.append(opt);
  }
  if (!voices.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No Spanish voices found';
    select.append(opt);
  }
  const chosen = voices.find((v) => v.voiceURI === settings.voiceURI) || voices[0] || null;
  speaker.voice = chosen;
  speaker.rate = settings.rate;
  if (chosen) select.value = chosen.voiceURI;
  setEnvInfo(
    'voice',
    chosen && !/natural|online|neural/i.test(chosen.name)
      ? 'Tip: Edge\'s "Online (Natural)" voices sound much better; they need an internet connection.'
      : '',
  );
}

function syncSettingsForm() {
  for (const key of ['level', 'provider', 'claudeModel', 'ollamaModel', 'apiModel', 'stt', 'whisperModel', 'pauseMs', 'sensitivity', 'rate']) {
    $(key).value = settings[key];
  }
  $('showLatency').checked = settings.showLatency;
  $('pauseOut').textContent = `${(settings.pauseMs / 1000).toFixed(1)}s`;
  $('sensOut').textContent = `${Number(settings.sensitivity).toFixed(1)}×`;
  $('rateOut').textContent = `${Number(settings.rate).toFixed(2)}×`;
  $('claudeModelRow').hidden = settings.provider !== 'claude-code';
  $('ollamaModelRow').hidden = settings.provider !== 'ollama';
  $('apiModelRow').hidden = settings.provider !== 'api';
  $('whisperModelRow').hidden = settings.stt !== 'whisper';
  if ($('whisperNote')) $('whisperNote').hidden = settings.stt !== 'whisper';
}

const CONVERSATION_KEYS = new Set(['level', 'provider', 'claudeModel', 'ollamaModel', 'apiModel']);

$('settings').addEventListener('change', async (e) => {
  const key = e.target.id;
  if (!(key in DEFAULTS)) {
    if (key === 'voice') {
      settings.voiceURI = e.target.value;
      saveSettings();
      applyVoice();
    }
    return;
  }
  const el = e.target;
  settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  saveSettings();
  syncSettingsForm();

  if (key === 'pauseMs') {
    if (mic) mic.pauseMs = settings.pauseMs;
    if (edge) edge.pauseMs = settings.pauseMs;
  }
  if (key === 'sensitivity' && mic) mic.sensitivity = settings.sensitivity;
  if (key === 'rate') speaker.rate = settings.rate;
  if (key === 'showLatency' && !settings.showLatency) $('latency').hidden = true;
  if (CONVERSATION_KEYS.has(key)) await newConversation('Settings changed. Valeria starts fresh.');
  if ((key === 'stt' || key === 'whisperModel') && started) await switchRecognizer();
});

$('settings').addEventListener('input', (e) => {
  if (e.target.type === 'range') $(e.target.id).dispatchEvent(new Event('change', { bubbles: true }));
});

async function switchRecognizer() {
  setMicActive(false);
  edge?.setActive(false);
  if (settings.stt === 'whisper') {
    setState('loading');
    try {
      await loadWhisper();
    } catch (err) {
      showNotice(`<strong>Whisper couldn't load:</strong> ${escapeHtml(err.message)}`);
    }
    $('loadProgress').hidden = true;
  } else {
    setupEdgeRecognizer();
  }
  mic.captureUtterances = settings.stt === 'whisper';
  resumeListening();
}

async function newConversation(note) {
  history = [];
  speaker.stop();
  await fetch('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  if (!started) return;
  addDivider(note);
  sendTurn({ kickoff: true });
}

$('newChat').addEventListener('click', () => {
  $('settings').close();
  newConversation('New conversation.');
});

$('settingsBtn').addEventListener('click', () => {
  syncSettingsForm();
  $('settings').showModal();
});

$('testVoice').addEventListener('click', () => {
  speaker.beginReply();
  speaker.push('¡Hola! Soy Valeria. ¿Me escuchas bien? ');
  speaker.endReply();
});

// ---------- Boot ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

syncSettingsForm();
setState('idle');
voicesReady().then(applyVoice);

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    if (settings.provider === 'claude-code' && !s.claudeCode.available) {
      showNotice('<strong>Claude Code wasn\'t found.</strong> Open a new terminal and check that <code>claude --version</code> works, then restart Habla. Or choose another model source in Settings.');
    } else if (s.claudeCode.available) {
      setEnvInfo('claude', `Claude Code ${s.claudeCode.version}.`);
    }
    if (settings.provider === 'claude-code' && s.claudeCode.available) {
      // Fresh conversation per page load; boots Claude Code before you press Start.
      fetch('/api/warm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: settings.claudeModel, level: settings.level }),
      }).catch(() => {});
    }
  })
  .catch(() => showNotice('<strong>Can\'t reach the Habla server.</strong> Is the terminal window running <code>npm start</code> still open?'));
