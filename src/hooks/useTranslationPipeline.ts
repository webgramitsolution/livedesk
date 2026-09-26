import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useScribe } from '@elevenlabs/react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore, type TranscriptEntry } from '@/store/meetingStore';
import { getDataBus, newMessageId } from '@/lib/dataPlane';
import { WebSpeechSttProvider } from '@/lib/translation/stt/webSpeech';
import { createTranslationProvider } from '@/lib/translation/translate';
import { WebSpeechTtsProvider } from '@/lib/translation/tts';
import { decideForSegment, shouldPublishSegment } from '@/lib/translation/pipeline';
import { languageLocale, normalizeLanguageCode } from '@/lib/translation/languages';
import type { LanguageMessage, SttSegment, TranscriptMessage } from '@/lib/translation/types';
import { startLevelMeter } from '@/lib/audio/levelMeter';
import { logWebRTCEvent } from '@/lib/webrtcLogger';

interface Options {
  enabled: boolean; // in meeting
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
}

const SUBTITLE_TTL_MS = 6000;

const formatTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Real-time voice translation for the meeting.
 *
 * Speaker side: local microphone -> streaming STT (browser engine, or the
 * ElevenLabs Scribe realtime service when the browser has none) -> transcript
 * segments broadcast on the `stt` data-plane topic with the source language.
 *
 * Receiver side: every incoming final segment whose language differs from the
 * receiver's preferred language is translated locally into that language and
 * spoken through a separate TTS layer. The original WebRTC audio track is
 * never modified; only its local playback volume follows the audio mode.
 */
export function useTranslationPipeline({ enabled, localStream, remoteStreams }: Options) {
  const translation = useMeetingStore((s) => s.translation);
  const isMicOn = useMeetingStore((s) => s.isMicOn);
  const sessionId = useMeetingStore((s) => s.meetingSessionId);
  const userName = useMeetingStore((s) => s.userName) || 'You';
  const permissionRows = useMeetingStore((s) => s.session.permissionRows);
  const meetingControls = useMeetingStore((s) => s.session.meetingControls);
  const setTranslationStatus = useMeetingStore((s) => s.setTranslationStatus);
  const canSpeak = useMeetingStore.getState().myPermission().canSpeak;
  void permissionRows;
  void meetingControls;

  const webSpeech = useMemo(() => new WebSpeechSttProvider(), []);
  const translator = useMemo(() => createTranslationProvider(), []);
  const tts = useMemo(() => new WebSpeechTtsProvider(), []);
  const translationRef = useRef(translation);
  useEffect(() => {
    translationRef.current = translation;
  }, [translation]);
  const lastInterimAtRef = useRef(0);
  const scribeLatencyRef = useRef(0);

  useEffect(() => {
    setTranslationStatus({ ttsAvailable: tts.isAvailable(), translationProvider: translator.name });
  }, [tts, translator, setTranslationStatus]);

  const sourceLanguage = translation.sourceLanguage === 'auto' ? translation.preferredLanguage : translation.sourceLanguage;

  // ----- Speaker side: publish segments -----
  const publishSegment = useCallback(
    (segment: SttSegment) => {
      if (!shouldPublishSegment(segment, lastInterimAtRef.current)) return;
      if (!segment.isFinal) lastInterimAtRef.current = segment.at;
      const language = segment.language ?? translationRef.current.sourceLanguage;
      const message: TranscriptMessage = {
        kind: 'segment',
        segId: segment.id,
        speakerId: sessionId,
        speakerName: userName,
        text: segment.text,
        isFinal: segment.isFinal,
        confidence: segment.confidence,
        sourceLanguage: language === 'auto' ? translationRef.current.preferredLanguage : language,
        at: segment.at,
      };
      try {
        getDataBus().publish('stt', message);
      } catch (err) {
        logWebRTCEvent('error', 'stt-publish-failed', { reason: String(err) });
      }
      // Own captions (never translated for ourselves).
      useMeetingStore.getState().upsertTranscript({
        id: message.segId,
        speakerId: sessionId,
        speaker: userName,
        text: message.text,
        translatedText: null,
        sourceLanguage: message.sourceLanguage,
        targetLanguage: null,
        confidence: message.confidence,
        status: message.isFinal ? (message.confidence !== null && message.confidence < 0.55 ? 'low-confidence' : 'final') : 'live',
        timestamp: formatTime(message.at),
        at: message.at,
        isActive: true,
      });
    },
    [sessionId, userName],
  );

  // Fallback STT: ElevenLabs Scribe (used only when the browser has no engine).
  const scribeSegIdRef = useRef<string | null>(null);
  const scribe = useScribe({
    modelId: 'scribe_v2_realtime',
    commitStrategy: 'vad' as never,
    onPartialTranscript: (data) => {
      if (!data.text.trim()) return;
      if (!scribeSegIdRef.current) {
        scribeSegIdRef.current = `sc-${newMessageId()}`;
        scribeLatencyRef.current = Date.now();
      }
      publishSegment({ id: scribeSegIdRef.current, text: data.text, isFinal: false, confidence: null, language: normalizeLanguageCode(sourceLanguage), at: Date.now() });
    },
    onCommittedTranscript: (data) => {
      if (!data.text.trim()) return;
      const id = scribeSegIdRef.current ?? `sc-${newMessageId()}`;
      scribeSegIdRef.current = null;
      publishSegment({ id, text: data.text, isFinal: true, confidence: null, language: normalizeLanguageCode(sourceLanguage), at: Date.now() });
      if (scribeLatencyRef.current) {
        useMeetingStore.getState().setAiLatencyMs(Date.now() - scribeLatencyRef.current);
        scribeLatencyRef.current = 0;
      }
    },
    onError: (err) => {
      setTranslationStatus({ stt: 'error', sttDetail: err instanceof Error ? err.message : 'Transcription error' });
    },
  });
  const scribeRef = useRef(scribe);
  useEffect(() => {
    scribeRef.current = scribe;
  }, [scribe]);

  const speakerActive = enabled && translation.enabled && isMicOn && canSpeak;
  useEffect(() => {
    if (!speakerActive) {
      webSpeech.stop();
      if (scribeRef.current.isConnected) scribeRef.current.disconnect();
      setTranslationStatus({ stt: 'idle', sttDetail: null });
      return;
    }
    let cancelled = false;
    if (webSpeech.isAvailable()) {
      setTranslationStatus({ sttProvider: 'browser' });
      void webSpeech.start({
        locale: languageLocale(sourceLanguage),
        onSegment: publishSegment,
        onStatus: (status, detail) => {
          if (!cancelled) setTranslationStatus({ stt: status, sttDetail: detail ?? null });
        },
      });
      return () => {
        cancelled = true;
        webSpeech.stop();
      };
    }
    // No browser engine (Firefox, Electron): use the hosted Scribe service.
    setTranslationStatus({ stt: 'starting', sttProvider: 'elevenlabs-scribe', sttDetail: null });
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('elevenlabs-scribe-token');
        if (error || !data?.token) throw new Error(error?.message || 'Transcription service unavailable');
        if (cancelled) return;
        await scribeRef.current.connect({ token: data.token, languageCode: normalizeLanguageCode(sourceLanguage) ?? undefined, microphone: { echoCancellation: true, noiseSuppression: true } });
        if (!cancelled) setTranslationStatus({ stt: 'listening', sttDetail: null });
      } catch (err) {
        if (!cancelled) setTranslationStatus({ stt: 'unavailable', sttDetail: err instanceof Error ? err.message : 'Transcription unavailable' });
      }
    })();
    return () => {
      cancelled = true;
      if (scribeRef.current.isConnected) scribeRef.current.disconnect();
    };
    // scribe object identity changes every render; we use the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerActive, sourceLanguage, webSpeech, publishSegment, setTranslationStatus]);

  // ----- Language announcements -----
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const bus = getDataBus();
    const announce = (to?: string) => {
      try {
        bus.publish('state', { type: 'language', language: translation.preferredLanguage } satisfies LanguageMessage, to ? { to } : {});
      } catch {
        /* ignore */
      }
    };
    announce();
    useMeetingStore.getState().setParticipantLanguage(sessionId, translation.preferredLanguage);
    const unsubscribe = bus.subscribe<LanguageMessage>('state', (payload, ctx) => {
      if (payload?.type === 'language') {
        const code = normalizeLanguageCode(payload.language);
        if (code) useMeetingStore.getState().setParticipantLanguage(ctx.from, code);
      }
    });
    const unsubscribeLink = bus.onPeerChannel((e) => {
      if (e.state === 'open') announce(e.peerId);
    });
    return () => {
      unsubscribe();
      unsubscribeLink();
    };
  }, [enabled, sessionId, translation.preferredLanguage]);

  // ----- Receiver side: captions, translation, TTS -----
  useEffect(() => {
    if (!enabled) return;
    const bus = getDataBus();
    const unsubscribe = bus.subscribe<TranscriptMessage>('stt', (message, ctx) => {
      if (!message || message.kind !== 'segment' || typeof message.text !== 'string') return;
      if (message.speakerId !== ctx.from) return;
      const settings = translationRef.current;
      const store = useMeetingStore.getState();
      const source = normalizeLanguageCode(message.sourceLanguage) ?? message.sourceLanguage;
      const decision = decideForSegment({ ...message, sourceLanguage: source }, settings);
      const entry: TranscriptEntry = {
        id: message.segId,
        speakerId: message.speakerId,
        speaker: message.speakerName,
        text: message.text,
        translatedText: null,
        sourceLanguage: source,
        targetLanguage: decision.translate ? settings.preferredLanguage : null,
        confidence: message.confidence,
        status: !message.isFinal ? 'live' : decision.translate ? 'translating' : decision.reason === 'low-confidence' ? 'low-confidence' : 'final',
        timestamp: formatTime(message.at),
        at: message.at,
        isActive: true,
      };
      store.upsertTranscript(entry);
      if (!decision.translate) return;

      const startedAt = Date.now();
      translator
        .translate(message.text, source, settings.preferredLanguage)
        .then((result) => {
          const current = useMeetingStore.getState();
          current.patchTranscript(message.segId, { translatedText: result.text, status: 'translated', at: Date.now(), isActive: true });
          current.setAiLatencyMs(Date.now() - startedAt);
          if (decision.speak && translationRef.current.audioMode !== 'original') {
            void tts.speak(result.text, translationRef.current.preferredLanguage);
          }
        })
        .catch((err) => {
          useMeetingStore.getState().patchTranscript(message.segId, { status: 'error' });
          useMeetingStore.getState().setTranslationStatus({ lastError: err instanceof Error ? err.message : 'Translation failed' });
          logWebRTCEvent('error', 'translation-failed', { reason: String(err) });
        });
    });
    const expiry = window.setInterval(() => useMeetingStore.getState().expireTranscripts(SUBTITLE_TTL_MS), 1000);
    return () => {
      unsubscribe();
      window.clearInterval(expiry);
      tts.cancel();
    };
  }, [enabled, translator, tts]);

  // Stop speaking when translation is switched off or the mode changes to original.
  useEffect(() => {
    if (!translation.enabled || translation.audioMode === 'original') tts.cancel();
  }, [translation.enabled, translation.audioMode, tts]);

  // ----- Speaking indicators (local + remote) via AudioWorklet level meter -----
  useEffect(() => {
    if (!enabled || !localStream) return;
    const handle = startLevelMeter(localStream, ({ speaking }) => {
      useMeetingStore.getState().setParticipantSpeaking('1', speaking && useMeetingStore.getState().isMicOn);
    });
    return () => handle.stop();
  }, [enabled, localStream]);

  useEffect(() => {
    if (!enabled) return;
    const handles: Array<{ stop: () => void }> = [];
    remoteStreams.forEach((stream, peerId) => {
      if (stream.getAudioTracks().length === 0) return;
      handles.push(startLevelMeter(stream, ({ speaking }) => useMeetingStore.getState().setParticipantSpeaking(peerId, speaking)));
    });
    return () => handles.forEach((h) => h.stop());
  }, [enabled, remoteStreams]);
}
