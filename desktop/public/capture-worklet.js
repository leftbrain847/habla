// Runs on the audio thread. Groups the microphone stream into 32 ms frames
// (512 samples at 16 kHz) and sends each frame with its loudness.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(input.length - offset, this.frame.length - this.filled);
      this.frame.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === this.frame.length) {
        let sum = 0;
        for (let i = 0; i < this.frame.length; i++) sum += this.frame[i] * this.frame[i];
        const samples = this.frame.slice();
        this.port.postMessage({ samples, rms: Math.sqrt(sum / samples.length) }, [samples.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
