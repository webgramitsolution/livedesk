import { X, Languages, Volume2, Waves, ShieldCheck, Mic, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { useMeetingStore, type TranscriptEntry } from '@/store/meetingStore';
import { Switch } from '@/components/ui/switch';
import { motion, AnimatePresence } from 'framer-motion';
import { usePanelOverlayMode } from '@/hooks/use-mobile';
import { SUPPORTED_LANGUAGES, languageLabel } from '@/lib/translation/languages';
import { cn } from '@/lib/utils';

function SttStatusLine() {
  const status = useMeetingStore((s) => s.translationStatus);
  const enabled = useMeetingStore((s) => s.translation.enabled);
  const isMicOn = useMeetingStore((s) => s.isMicOn);
  if (!enabled) return <p className="text-[11px] text-muted-foreground">Translation is off. Turn it on to hear other languages in yours.</p>;
  if (!isMicOn) return <p className="text-[11px] text-muted-foreground">Your microphone is off; your speech is not transcribed. Others are still translated for you.</p>;
  const map = {
    idle: { Icon: Mic, tone: 'text-muted-foreground', label: 'Speech recognition idle' },
    starting: { Icon: Loader2, tone: 'text-muted-foreground', label: 'Starting speech recognition' },
    listening: { Icon: CheckCircle2, tone: 'text-success', label: `Listening (${status.sttProvider === 'browser' ? 'browser engine' : 'ElevenLabs Scribe'})` },
    error: { Icon: AlertTriangle, tone: 'text-destructive', label: status.sttDetail || 'Speech recognition error' },
    unavailable: { Icon: AlertTriangle, tone: 'text-amber-500', label: status.sttDetail || 'Speech recognition unavailable' },
  } as const;
  const cfg = map[status.stt];
  return (
    <p className={cn('flex items-center gap-1.5 text-[11px]', cfg.tone)} data-testid="stt-status">
      <cfg.Icon className={cn('h-3 w-3', status.stt === 'starting' && 'animate-spin')} /> {cfg.label}
    </p>
  );
}

function TranscriptItem({ entry, mine }: { entry: TranscriptEntry; mine: boolean }) {
  const statusLabel =
    entry.status === 'translating'
      ? 'translating'
      : entry.status === 'low-confidence'
        ? 'low confidence, not translated'
        : entry.status === 'error'
          ? 'translation failed'
          : entry.status === 'live'
            ? 'live'
            : null;
  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: entry.status === 'live' ? 0.65 : 1, x: 0 }} className="mb-2" data-testid="transcript-entry">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">[{entry.timestamp}]</span>
        <span className={cn('text-xs font-bold', mine ? 'text-primary' : 'text-foreground')}>{entry.speaker}</span>
        <span className="rounded bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">{languageLabel(entry.sourceLanguage)}</span>
        {statusLabel && (
          <span className={cn('text-[9px]', entry.status === 'error' || entry.status === 'low-confidence' ? 'text-amber-600' : 'text-muted-foreground', entry.status === 'translating' && 'animate-pulse text-primary')}>
            {statusLabel}
          </span>
        )}
      </div>
      <div className={cn('border-l-2 pl-3', mine ? 'border-primary' : entry.translatedText ? 'border-success' : 'border-border')}>
        {entry.translatedText ? (
          <>
            <p className="text-sm leading-relaxed text-foreground">{entry.translatedText}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">{entry.text}</p>
          </>
        ) : (
          <p className={cn('text-sm leading-relaxed', entry.status === 'live' ? 'italic text-muted-foreground' : 'text-foreground')}>{entry.text}</p>
        )}
      </div>
    </motion.div>
  );
}

export function AISidebar() {
  const rightPanel = useMeetingStore((s) => s.rightPanel);
  const toggleRightPanel = useMeetingStore((s) => s.toggleRightPanel);
  const translation = useMeetingStore((s) => s.translation);
  const setTranslation = useMeetingStore((s) => s.setTranslation);
  const status = useMeetingStore((s) => s.translationStatus);
  const isNoiseCancellationOn = useMeetingStore((s) => s.isNoiseCancellationOn);
  const toggleNoiseCancellation = useMeetingStore((s) => s.toggleNoiseCancellation);
  const transcript = useMeetingStore((s) => s.transcript);
  const participants = useMeetingStore((s) => s.participants);
  const aiLatencyMs = useMeetingStore((s) => s.aiLatencyMs);
  const mode = usePanelOverlayMode();
  const isOverlay = mode !== 'desktop';
  const isMobile = mode === 'mobile';
  const isOpen = rightPanel === 'ai';

  const otherLanguages = Array.from(new Set(participants.filter((p) => p.id !== '1').map((p) => p.spokenLanguage))).filter((l) => l !== translation.preferredLanguage);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isOverlay && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-sm" onClick={() => toggleRightPanel('ai')} />
          )}
          <motion.aside
            initial={isMobile ? { y: '100%', opacity: 0.6 } : mode === 'tablet' ? { x: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { y: 0, opacity: 1 } : mode === 'tablet' ? { x: 0, opacity: 1 } : { width: 340, opacity: 1 }}
            exit={isMobile ? { y: '100%', opacity: 0.6 } : mode === 'tablet' ? { x: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`${isMobile ? 'fixed inset-0 z-[60] rounded-none border-0' : mode === 'tablet' ? 'fixed inset-y-0 right-0 w-[90vw] max-w-[420px] z-[60] border-l shadow-2xl' : 'h-full shrink-0 border-l'} bg-background flex flex-col overflow-hidden`}
            style={mode === 'desktop' ? { width: 340 } : undefined}
            data-testid="translation-panel"
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Languages className="h-5 w-5 text-primary" />
                <h2 className="font-display text-lg font-bold text-foreground">Live Translation</h2>
              </div>
              <button onClick={() => toggleRightPanel('ai')} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted" aria-label="Close translation panel">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`space-y-3 border-b border-border ${isMobile ? 'px-4 pb-4 pt-3' : 'p-4'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Voice translation</span>
                <Switch checked={translation.enabled} onCheckedChange={(v) => setTranslation({ enabled: v })} data-testid="translation-toggle" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  I want to hear
                  <select
                    value={translation.preferredLanguage}
                    onChange={(e) => setTranslation({ preferredLanguage: e.target.value as typeof translation.preferredLanguage })}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                    data-testid="preferred-language"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label} ({l.nativeLabel})</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-muted-foreground">
                  I speak
                  <select
                    value={translation.sourceLanguage}
                    onChange={(e) => setTranslation({ sourceLanguage: e.target.value as typeof translation.sourceLanguage })}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                    data-testid="source-language"
                  >
                    <option value="auto">Same as above</option>
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Audio for other languages</p>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Audio mode">
                  {(['original', 'translated', 'both'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={translation.audioMode === m}
                      onClick={() => setTranslation({ audioMode: m })}
                      className={cn('rounded-md px-2 py-1 text-[11px] font-medium capitalize', translation.audioMode === m ? 'bg-background text-foreground shadow' : 'text-muted-foreground')}
                      data-testid={`audio-mode-${m}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {!status.ttsAvailable && translation.enabled && (
                  <p className="mt-1 text-[10px] text-amber-600">Speech output is unavailable in this browser; translations are shown as captions.</p>
                )}
              </div>

              {translation.enabled && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5" data-testid="translation-indicator">
                  <p className="text-xs font-bold text-primary">
                    {otherLanguages.length > 0
                      ? `Live Translation: ${otherLanguages.map(languageLabel).join(', ')} → ${languageLabel(translation.preferredLanguage)}`
                      : `Live Translation: waiting for another language (you hear ${languageLabel(translation.preferredLanguage)})`}
                  </p>
                  <SttStatusLine />
                  {status.lastError && <p className="mt-1 text-[10px] text-destructive">{status.lastError}</p>}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Waves className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Noise filter</span>
                </div>
                <Switch checked={isNoiseCancellationOn} onCheckedChange={toggleNoiseCancellation} />
              </div>
              {isNoiseCancellationOn && (
                <p className="flex items-center gap-1.5 text-[11px] text-success"><ShieldCheck className="h-3.5 w-3.5" /> High-pass, low-pass and compression applied to your microphone.</p>
              )}
            </div>

            <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4' : 'p-4'}`}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Captions</h3>
              {transcript.length === 0 && (
                <p className="text-xs text-muted-foreground">Captions appear here as people speak{translation.enabled ? '' : ' once translation is on'}.</p>
              )}
              {transcript.map((entry) => (
                <TranscriptItem key={entry.id} entry={entry} mine={entry.speakerId === useMeetingStore.getState().meetingSessionId} />
              ))}
            </div>

            <div className="border-t border-border bg-secondary/50 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-sm font-bold text-foreground">{aiLatencyMs > 0 ? `${(aiLatencyMs / 1000).toFixed(1)}s` : '–'}</p>
                  <p className="text-[10px] text-muted-foreground">Last translation</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{status.translationProvider ?? '–'}</p>
                  <p className="text-[10px] text-muted-foreground">Provider</p>
                </div>
                <div>
                  <p className="flex items-center justify-center gap-1 text-sm font-bold text-primary"><Volume2 className="h-3.5 w-3.5" /> {status.ttsAvailable ? 'On' : 'Off'}</p>
                  <p className="text-[10px] text-muted-foreground">Speech output</p>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
