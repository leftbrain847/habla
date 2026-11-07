// Whisper speech-to-text, running in a background thread inside Edge.
// Uses the GPU (WebGPU) when available, otherwise the CPU (WebAssembly).
// The model downloads from Hugging Face on first use, then stays cached.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;

let transcriber = null;
let device = null;

async function hasWebGPU() {
  try {
    return Boolean(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model) {
  const progress_callback = (p) => {
    if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
  };
  const attempts = (await hasWebGPU())
    ? [
        { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
        { device: 'wasm', dtype: 'q8' },
      ]
    : [{ device: 'wasm', dtype: 'q8' }];

  let lastError;
  for (const opts of attempts) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', model, { ...opts, progress_callback });
      device = opts.device;
      // First run compiles the model; do it now so your first sentence is fast.
      await transcriber(new Float32Array(16000), { language: 'spanish', task: 'transcribe' });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      transcriber = null;
      await load(data.model);
      self.postMessage({ type: 'ready', device, model: data.model });
    } else if (data.type === 'transcribe') {
      const started = performance.now();
      const out = await transcriber(data.audio, { language: 'spanish', task: 'transcribe' });
      self.postMessage({ type: 'result', id: data.id, text: out.text.trim(), ms: Math.round(performance.now() - started) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err?.message || err) });
  }
};
