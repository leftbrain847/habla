// Speaks the partner's reply sentence by sentence as it streams in, using
// the browser's voices. Edge includes Microsoft's natural neural voices.

export function listSpanishVoices() {
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('es'))
    .sort((a, b) => rankVoice(b) - rankVoice(a));
}

// Prefer Mexican, natural-sounding, female (Valeria) voices.
function rankVoice(v) {
  let score = 0;
  if (v.lang.toLowerCase() === 'es-mx') score += 100;
  if (/natural|online|neural/i.test(v.name)) score += 50;
  if (/dalia|renata|beatriz|candela|carlota|larissa|marina|nuria|yolanda|paulina|sabina/i.test(v.name)) score += 10;
  return score;
}

export function voicesReady() {
  if (speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.addEventListener('voiceschanged', () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
}

export class Speaker {
  constructor({ onStart, onIdle }) {
    this.onStart = onStart; // first sound of a reply
    this.onIdle = onIdle; // reply finished and queue empty
    this.voice = null;
    this.rate = 0.95;
    this.enabled = true;
    this.#resetReply();
  }

  #resetReply() {
    this.buffer = '';
    this.pending = 0;
    this.streamDone = false;
    this.started = false;
    this.utterances = []; // keep references so Chromium doesn't drop callbacks
  }

  beginReply() {
    speechSynthesis.cancel();
    this.#resetReply();
  }

  // Feed streamed text; complete sentences are spoken immediately.
  push(text) {
    this.buffer += text;
    let match;
    const boundary = /[^.!?…]*[.!?…]+["'»”)]*\s+/y;
    let consumed = 0;
    boundary.lastIndex = 0;
    while ((match = boundary.exec(this.buffer))) {
      this.#speak(match[0]);
      consumed = boundary.lastIndex;
    }
    this.buffer = this.buffer.slice(consumed);
  }

  endReply() {
    this.streamDone = true;
    if (this.buffer.trim()) this.#speak(this.buffer);
    this.buffer = '';
    if (this.pending === 0) this.#finish();
  }

  stop() {
    speechSynthesis.cancel();
    this.#resetReply();
  }

  #speak(raw) {
    const text = cleanForSpeech(raw);
    if (!text || !this.enabled) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang || 'es-MX';
    u.rate = this.rate;
    u.onstart = () => {
      if (!this.started) {
        this.started = true;
        this.onStart?.(performance.now());
      }
    };
    u.onend = u.onerror = () => {
      this.pending--;
      if (this.pending === 0 && this.streamDone) this.#finish();
    };
    this.pending++;
    this.utterances.push(u);
    speechSynthesis.speak(u);
  }

  #finish() {
    // Give the speaker a moment to fall silent before the mic reopens.
    setTimeout(() => this.onIdle?.(), 250);
  }
}

function cleanForSpeech(text) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[*_#`~\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
