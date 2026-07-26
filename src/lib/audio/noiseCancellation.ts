export interface NoiseCancelledStreamResult {
  cleanup: () => void;
  stream: MediaStream;
}

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;

  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
};

export function createNoiseCancelledStream(sourceStream: MediaStream): NoiseCancelledStreamResult {
  const AudioContextCtor = getAudioContext();
  const audioTracks = sourceStream.getAudioTracks();

  if (!AudioContextCtor || audioTracks.length === 0) {
    return {
      cleanup: () => undefined,
      stream: sourceStream,
    };
  }

  const audioContext = new AudioContextCtor();
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined);
  }
  const audioOnlyStream = new MediaStream(audioTracks);
  const sourceNode = audioContext.createMediaStreamSource(audioOnlyStream);

  const highPass = audioContext.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 120;
  highPass.Q.value = 0.8;

  const lowPass = audioContext.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.value = 7600;
  lowPass.Q.value = 0.7;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -30;
  compressor.knee.value = 16;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  const gain = audioContext.createGain();
  gain.gain.value = 1.15;

  const destination = audioContext.createMediaStreamDestination();

  sourceNode.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(compressor);
  compressor.connect(gain);
  gain.connect(destination);

  const processedStream = new MediaStream();
  sourceStream.getVideoTracks().forEach((track) => processedStream.addTrack(track));
  destination.stream.getAudioTracks().forEach((track) => processedStream.addTrack(track));

  return {
    cleanup: () => {
      destination.stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => undefined);
    },
    stream: processedStream,
  };
}