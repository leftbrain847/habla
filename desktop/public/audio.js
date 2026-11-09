// Microphone capture plus a simple voice-activity detector.
// Emits one Float32Array (16 kHz mono) per utterance, after you pause.

export const SAMPLE_RATE = 16000;
const FRAME_MS = 32; // 512 samples
const PREROLL_FRAMES = 10; // keep ~320 ms before speech starts
const START_FRAMES = 3; // ~100 ms above threshold to count as speech
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 30_000;

export class Microphone {
  constructor({ onLevel, onSpeechStart, onSpeechCancel, onUtterance }) {
    this.onLevel = onLevel;
    this.onSpeechStart = onSpeechStart;
    this.onSpeechCancel = onSpeechCancel;
    this.onUtterance = onUtterance;
    this.pauseMs = 1200;
    this.sensitivity = 1; // higher = picks up quieter speech
    this.active = false; // when false, audio is ignored (partner speaking, thinking)
    this.captureUtterances = true; // false when another engine does the listening
    this.#reset();
    this.noiseFloor = 0.005;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule('capture-worklet.js');
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor');
    this.node.port.onmessage = ({ data }) => this.#onFrame(data.samples, data.rms);
    source.connect(this.node);
    // Keep the graph pulling audio without playing the mic back out loud.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  setActive(on) {
    this.active = on;
    if (!on) this.#reset();
  }

  #reset() {
    this.preroll = [];
    this.speech = [];
    this.inSpeech = false;
    this.loudFrames = 0;
    this.silentMs = 0;
  }

  #onFrame(samples, rms) {
    // Track background noise slowly when nobody is talking.
    if (!this.inSpeech) {
      this.noiseFloor = rms < this.noiseFloor ? rms : this.noiseFloor * 0.995 + rms * 0.005;
    }
    const threshold = Math.max(0.008, this.noiseFloor * 3) / this.sensitivity;
    this.onLevel?.(Math.min(1, rms / 0.15), rms > threshold && this.active);

    if (!this.active || !this.captureUtterances) return;

    if (!this.inSpeech) {
      this.preroll.push(samples);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      this.loudFrames = rms > threshold ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= START_FRAMES) {
        this.inSpeech = true;
        this.speech = [...this.preroll];
        this.preroll = [];
        this.silentMs = 0;
        this.onSpeechStart?.();
      }
      return;
    }

    this.speech.push(samples);
    this.silentMs = rms > threshold * 0.7 ? 0 : this.silentMs + FRAME_MS;
    const durationMs = this.speech.length * FRAME_MS;
    if (this.silentMs >= this.pauseMs || durationMs >= MAX_UTTERANCE_MS) {
      const voicedMs = durationMs - this.silentMs;
      const frames = this.speech;
      this.#reset();
      if (voicedMs >= MIN_SPEECH_MS) this.onUtterance?.(concat(frames), performance.now());
      else this.onSpeechCancel?.();
    }
  }
}

function concat(frames) {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}
