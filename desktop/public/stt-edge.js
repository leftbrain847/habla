// Edge's built-in speech recognition (Microsoft's online service).
// Streams words as you speak; we end your turn after a pause.

export function edgeRecognitionAvailable() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class EdgeRecognizer {
  constructor({ lang = 'es-MX', onInterim, onUtterance, onError }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.rec = new SR();
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.onInterim = onInterim;
    this.onUtterance = onUtterance;
    this.onError = onError;
    this.pauseMs = 1200;
    this.listening = false;
    this.finalText = '';
    this.timer = null;

    this.rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      this.onInterim?.((this.finalText + interim).trim());
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.#finishTurn(), this.pauseMs);
    };
    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError?.(e.error === 'not-allowed' ? 'Microphone access was blocked.' : `Speech recognition error: ${e.error}`);
    };
    // The service stops on its own after a while; restart while we listen.
    this.rec.onend = () => {
      if (this.listening) {
        try {
          this.rec.start();
        } catch {}
      }
    };
  }

  setActive(on) {
    if (on === this.listening) return;
    this.listening = on;
    this.finalText = '';
    clearTimeout(this.timer);
    try {
      if (on) this.rec.start();
      else this.rec.abort();
    } catch {}
  }

  #finishTurn() {
    const text = this.finalText.trim();
    if (!text) return;
    this.finalText = '';
    this.onUtterance?.(text, performance.now() - this.pauseMs);
  }
}
