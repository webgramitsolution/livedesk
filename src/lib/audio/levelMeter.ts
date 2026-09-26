// Speaking detection for any MediaStream (local mic or a remote peer).
// Prefers the AudioWorklet processor in public/worklets/level-meter.worklet.js
// and falls back to an AnalyserNode polled with requestAnimationFrame.

export interface LevelMeterHandle {
  stop: () => void;
}

export interface LevelReport {
  rms: number;
  speaking: boolean;
}

let sharedContext: AudioContext | null = null;
let workletLoaded: Promise<boolean> | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new Ctor();
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => undefined);
  return sharedContext;
}

async function ensureWorklet(ctx: AudioContext): Promise<boolean> {
  if (!('audioWorklet' in ctx)) return false;
  if (!workletLoaded) {
    workletLoaded = ctx.audioWorklet
      .addModule('/worklets/level-meter.worklet.js')
      .then(() => true)
      .catch(() => false);
  }
  return workletLoaded;
}

export function startLevelMeter(stream: MediaStream, onReport: (report: LevelReport) => void): LevelMeterHandle {
  const ctx = getContext();
  const audioTracks = stream.getAudioTracks();
  if (!ctx || audioTracks.length === 0) return { stop: () => undefined };

  let stopped = false;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioNode | null = null;
  let raf = 0;

  const audioOnly = new MediaStream(audioTracks);
  try {
    source = ctx.createMediaStreamSource(audioOnly);
  } catch {
    return { stop: () => undefined };
  }

  void ensureWorklet(ctx).then((ok) => {
    if (stopped || !source) return;
    if (ok) {
      const worklet = new AudioWorkletNode(ctx, 'level-meter', { numberOfInputs: 1, numberOfOutputs: 0 });
      worklet.port.onmessage = (e) => onReport(e.data as LevelReport);
      source.connect(worklet);
      node = worklet;
      return;
    }
    // Fallback: analyser polled on the UI thread (cheap, 20 Hz).
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    node = analyser;
    const buffer = new Float32Array(analyser.fftSize);
    let speaking = false;
    let lastVoiceAt = 0;
    let lastReport = 0;
    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      if (now - lastReport >= 50) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        if (rms >= 0.02) {
          speaking = true;
          lastVoiceAt = now;
        } else if (speaking && rms < 0.012 && now - lastVoiceAt > 350) {
          speaking = false;
        }
        lastReport = now;
        onReport({ rms, speaking });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  return {
    stop: () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      try {
        node?.disconnect();
        source?.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
