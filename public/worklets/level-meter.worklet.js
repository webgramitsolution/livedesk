// AudioWorklet: RMS level meter + energy-based voice activity detection.
// Runs on the audio rendering thread; posts compact messages ~20 times/s so
// the UI thread only updates speaking indicators, never processes samples.
class LevelMeterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.speakThreshold = p.speakThreshold ?? 0.02;
    this.silenceThreshold = p.silenceThreshold ?? 0.012;
    this.hangoverMs = p.hangoverMs ?? 350;
    this.reportIntervalMs = p.reportIntervalMs ?? 50;
    this.speaking = false;
    this.lastVoiceAt = 0;
    this.lastReportAt = 0;
    this.accum = 0;
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    let sum = 0;
    for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
    this.accum += sum;
    this.count += channel.length;

    const nowMs = currentTime * 1000;
    if (nowMs - this.lastReportAt >= this.reportIntervalMs && this.count > 0) {
      const rms = Math.sqrt(this.accum / this.count);
      this.accum = 0;
      this.count = 0;
      if (rms >= this.speakThreshold) {
        this.lastVoiceAt = nowMs;
        this.speaking = true;
      } else if (this.speaking && rms < this.silenceThreshold && nowMs - this.lastVoiceAt > this.hangoverMs) {
        this.speaking = false;
      }
      this.lastReportAt = nowMs;
      this.port.postMessage({ rms, speaking: this.speaking });
    }
    return true;
  }
}

registerProcessor('level-meter', LevelMeterProcessor);
