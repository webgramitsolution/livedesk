import { useScribe } from '@elevenlabs/react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';

export interface LiveTranscript {
  id: string;
  text: string;
  speaker: string;
  isPartial: boolean;
  timestamp: number;
  translatedText?: string;
  isTranslating?: boolean;
}

// Simple speaker assignment based on audio gaps
const SPEAKER_COLORS = ['You', 'Speaker 2', 'Speaker 3', 'Speaker 4', 'Speaker 5'];

export function useLiveTranscription() {
  const [liveTranscripts, setLiveTranscripts] = useState<LiveTranscript[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speakerIndexRef = useRef(0);
  const lastCommitTimeRef = useRef(0);
  const partialStartRef = useRef<number>(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number>(0);

  useEffect(() => {
    useMeetingStore.getState().setAiLatencyMs(lastLatencyMs);
  }, [lastLatencyMs]);

  const assignSpeaker = (): string => {
    const now = Date.now();
    const gap = now - lastCommitTimeRef.current;
    // If gap > 3s, likely a new speaker
    if (gap > 3000 && lastCommitTimeRef.current > 0) {
      speakerIndexRef.current = (speakerIndexRef.current + 1) % SPEAKER_COLORS.length;
    }
    lastCommitTimeRef.current = now;
    return SPEAKER_COLORS[speakerIndexRef.current];
  };

  const translateText = async (transcriptId: string, text: string, targetLang: string) => {
    try {
      setLiveTranscripts(prev =>
        prev.map(t => t.id === transcriptId ? { ...t, isTranslating: true } : t)
      );
      const { data, error: fnError } = await supabase.functions.invoke('translate-text', {
        body: { text, targetLanguage: targetLang },
      });
      if (fnError || !data?.translatedText) throw new Error('Translation failed');
      setLiveTranscripts(prev =>
        prev.map(t => t.id === transcriptId ? { ...t, translatedText: data.translatedText, isTranslating: false } : t)
      );
    } catch {
      setLiveTranscripts(prev =>
        prev.map(t => t.id === transcriptId ? { ...t, isTranslating: false } : t)
      );
    }
  };

  type ScribeOptions = Parameters<typeof useScribe>[0];
  const scribe = useScribe({
    modelId: 'scribe_v2_realtime' as ScribeOptions['modelId'],
    commitStrategy: 'vad' as ScribeOptions['commitStrategy'],
    onPartialTranscript: (data) => {
      if (data.text.trim() && partialStartRef.current === 0) {
        partialStartRef.current = Date.now();
      }
      setLiveTranscripts((prev) => {
        const withoutPartial = prev.filter((t) => !t.isPartial);
        if (!data.text.trim()) return withoutPartial;
        return [
          ...withoutPartial,
          { id: 'partial', text: data.text, speaker: SPEAKER_COLORS[speakerIndexRef.current], isPartial: true, timestamp: Date.now() },
        ];
      });
    },
    onCommittedTranscript: (data) => {
      if (!data.text.trim()) return;
      if (partialStartRef.current > 0) {
        setLastLatencyMs(Date.now() - partialStartRef.current);
        partialStartRef.current = 0;
      }
      const speaker = assignSpeaker();
      const id = String(Date.now());
      setLiveTranscripts((prev) => {
        const withoutPartial = prev.filter((t) => !t.isPartial);
        return [
          ...withoutPartial,
          { id, text: data.text, speaker, isPartial: false, timestamp: Date.now() },
        ];
      });
      return id;
    },
  });

  const start = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    speakerIndexRef.current = 0;
    lastCommitTimeRef.current = 0;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { data, error: fnError } = await supabase.functions.invoke('elevenlabs-scribe-token');
      if (fnError || !data?.token) {
        throw new Error(fnError?.message || 'Failed to get transcription token');
      }
      await scribe.connect({
        token: data.token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start transcription';
      setError(msg);
      console.error('Live transcription error:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [scribe]);

  const stop = useCallback(() => {
    scribe.disconnect();
    setLiveTranscripts([]);
  }, [scribe]);

  return {
    isConnected: scribe.isConnected,
    isConnecting,
    liveTranscripts,
    partialText: scribe.partialTranscript,
    error,
    start,
    stop,
    translateText,
    lastLatencyMs,
  };
}
