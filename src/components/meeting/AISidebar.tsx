import { X, BrainCircuit, Languages, Volume2, ShieldCheck, Waves, Mic, MicOff } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { Switch } from '@/components/ui/switch';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiveTranscription } from '@/hooks/useLiveTranscription';
import { useIsMobile } from '@/hooks/use-mobile';

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
  pt: 'Portuguese', hi: 'Hindi',
};

const TRANSLATED_SAMPLES: Record<string, Record<string, string>> = {
  'Sarah Chen': {
    en: 'Let me share the latest metrics from Q4...',
    hi: 'मुझे Q4 से नवीनतम मेट्रिक्स साझा करने दें...',
    es: 'Permítanme compartir las últimas métricas del Q4...',
    fr: 'Permettez-moi de partager les dernières métriques du Q4...',
    de: 'Lassen Sie mich die neuesten Kennzahlen aus Q4 teilen...',
    zh: '让我分享第四季度的最新指标...',
    ja: 'Q4の最新指標を共有させてください...',
    ko: 'Q4의 최신 지표를 공유하겠습니다...',
  },
  'Alex Rivera': {
    en: 'The conversion rates look promising this quarter.',
    hi: 'इस तिमाही में रूपांतरण दरें आशाजनक दिख रही हैं।',
    es: 'Las tasas de conversión parecen prometedoras este trimestre.',
  },
  'You': {
    en: 'Can we look at the regional breakdown?',
    hi: 'क्या हम क्षेत्रीय विश्लेषण देख सकते हैं?',
    es: '¿Podemos ver el desglose regional?',
  },
  'Maya Singh': {
    en: 'I have the APAC numbers ready to present.',
    hi: 'मेरे पास APAC के आंकड़े प्रस्तुत करने के लिए तैयार हैं।',
    es: 'Tengo los números de APAC listos para presentar.',
  },
  'David Kim': {
    en: 'Great, let us start with the overview.',
    hi: 'बढ़िया, चलिए अवलोकन से शुरू करते हैं।',
    es: 'Genial, comencemos con la descripción general.',
  },
};

export function AISidebar() {
  const {
    rightPanel, toggleRightPanel, isTranslationEnabled, toggleTranslation,
    isNoiseCancellationOn, toggleNoiseCancellation,
    transcript, selectedLanguage, participants,
  } = useMeetingStore();

  const { isConnected, isConnecting, liveTranscripts, partialText, error, start, stop, translateText } = useLiveTranscription();
  const isMobile = useIsMobile();

  const isOpen = rightPanel === 'ai';
  const langLabel = LANG_NAMES[selectedLanguage] || selectedLanguage.toUpperCase();

  const prevTranscriptsRef = liveTranscripts;
  if (isTranslationEnabled && selectedLanguage !== 'en') {
    prevTranscriptsRef.forEach((lt) => {
      if (!lt.isPartial && !lt.translatedText && !lt.isTranslating) {
        translateText(lt.id, lt.text, selectedLanguage);
      }
    });
  }

  const getTranslatedText = (speaker: string, originalText: string) => {
    if (!isTranslationEnabled || selectedLanguage === 'en') return originalText;
    return TRANSLATED_SAMPLES[speaker]?.[selectedLanguage] || originalText;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isMobile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-sm"
              onClick={() => toggleRightPanel('ai')}
            />
          )}
          <motion.aside
            initial={isMobile ? { y: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { width: 320, opacity: 1 }}
            exit={isMobile ? { y: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`${
              isMobile
                ? 'fixed inset-x-0 bottom-0 top-0 z-[60] rounded-none border-0'
                : 'h-full shrink-0 border-l'
            } bg-background flex flex-col overflow-hidden`}
            style={isMobile ? undefined : { width: 320 }}
          >
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary" />
              <h2 className="font-display font-bold text-foreground text-lg">AI Assistant</h2>
            </div>
            <button
              onClick={() => toggleRightPanel('ai')}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className={`space-y-4 border-b border-border ${isMobile ? 'px-4 pb-4 pt-3' : 'p-4'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Voice Translation</span>
              </div>
              <Switch checked={isTranslationEnabled} onCheckedChange={toggleTranslation} />
            </div>

            {isTranslationEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-primary/5 border border-primary/20 rounded-lg p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Languages className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-bold text-primary">Translating to {langLabel}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  All speech is translated in real-time. Change language in Settings.
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {participants.filter(p => !p.isMuted && p.id !== '1').map((p) => (
                    <span key={p.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-background border border-border text-muted-foreground">
                      {p.name.split(' ')[0]}: {LANG_NAMES[p.spokenLanguage] || p.spokenLanguage}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Noise Cancellation</span>
              </div>
              <Switch checked={isNoiseCancellationOn} onCheckedChange={toggleNoiseCancellation} />
            </div>

            {isNoiseCancellationOn && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-success/5 border border-success/20 rounded-lg p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-success" />
                  <span className="text-xs font-bold text-success">Noise Filter Active</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-success rounded-full"
                      animate={{ width: ['60%', '85%', '70%', '90%', '75%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">Filtering</span>
                </div>
              </motion.div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Voice Activity</span>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-all ${
                      i <= 3 ? 'h-3 bg-success' : 'h-2 bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-secondary rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success animate-pulse-glow' : 'bg-muted-foreground'}`} />
                  <span className={`text-xs font-bold ${isConnected ? 'text-success' : 'text-muted-foreground'}`}>
                    {isConnected ? 'ElevenLabs Scribe Active' : 'ElevenLabs Scribe'}
                  </span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={isConnected ? stop : start}
                  disabled={isConnecting}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    isConnected
                      ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  } disabled:opacity-50`}
                >
                  {isConnected ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  {isConnecting ? 'Connecting...' : isConnected ? 'Stop' : 'Start Live'}
                </motion.button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {isConnected ? 'Real-time transcription via microphone' : 'Click Start to transcribe your microphone input'}
              </p>
              {error && (
                <p className="text-[11px] text-destructive mt-1">{error}</p>
              )}
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto space-y-3 ${isMobile ? 'px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4' : 'p-4'}`}>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Live Transcript {isTranslationEnabled && selectedLanguage !== 'en' ? `(→ ${langLabel})` : ''}
            </h3>

            {liveTranscripts.map((lt) => {
              const SPEAKER_COLORS: Record<string, string> = {
                'You': 'text-primary border-primary',
                'Speaker 2': 'text-accent-foreground border-accent',
                'Speaker 3': 'text-success border-success',
                'Speaker 4': 'text-yellow-500 border-yellow-500',
                'Speaker 5': 'text-destructive border-destructive',
              };
              const colorClass = SPEAKER_COLORS[lt.speaker] || 'text-primary border-primary';
              const borderColor = lt.isPartial ? 'border-primary/40' : colorClass.split(' ')[1] || 'border-primary';

              return (
                <motion.div
                  key={lt.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: lt.isPartial ? 0.6 : 1, x: 0 }}
                  className="mb-2"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      [{new Date(lt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                    </span>
                    <span className={`text-xs font-bold ${colorClass.split(' ')[0]}`}>
                      {lt.speaker}
                    </span>
                    {lt.isPartial && <span className="text-[9px] text-muted-foreground font-normal">(live)</span>}
                    {lt.isTranslating && <span className="text-[9px] text-primary animate-pulse">translating...</span>}
                  </div>
                  <div className={`pl-4 border-l-2 ${borderColor}`}>
                    {lt.translatedText && (
                      <p className="text-[10px] text-muted-foreground/60 line-through mb-0.5">"{lt.text}"</p>
                    )}
                    <p className={`text-sm leading-relaxed ${lt.isPartial ? 'text-muted-foreground italic' : 'text-foreground'}`}>
                      "{lt.translatedText || lt.text}"
                      {lt.translatedText && <span className="ml-1 text-[9px] text-primary font-bold">🌐</span>}
                    </p>
                  </div>
                </motion.div>
              );
            })}

            {partialText && liveTranscripts.every(t => !t.isPartial) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} className="mb-2">
                <div className="pl-4 border-l-2 border-primary/30">
                  <p className="text-sm leading-relaxed text-muted-foreground italic">"{partialText}"</p>
                </div>
              </motion.div>
            )}
            {transcript.map((entry) => {
              const translated = getTranslatedText(entry.speaker, entry.text);
              const isTranslated = isTranslationEnabled && selectedLanguage !== 'en' && translated !== entry.text;
              const speakerParticipant = participants.find(p => p.name === entry.speaker);
              const speakerLang = speakerParticipant?.spokenLanguage;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`${entry.isActive ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      [{entry.timestamp}]
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        entry.isActive ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {entry.speaker}
                    </span>
                    {speakerLang && speakerLang !== 'en' && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">
                        {LANG_NAMES[speakerLang]?.slice(0, 3).toUpperCase() || speakerLang}
                      </span>
                    )}
                  </div>
                  <div className={`pl-4 border-l-2 ${entry.isActive ? 'border-primary' : 'border-border'}`}>
                    {isTranslated && (
                      <p className="text-[10px] text-muted-foreground/60 line-through mb-0.5">
                        "{entry.text}"
                      </p>
                    )}
                    <p className={`text-sm leading-relaxed ${entry.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                      "{translated}"
                      {isTranslated && (
                        <span className="ml-1 text-[9px] text-primary font-bold">🌐</span>
                      )}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="p-4 border-t border-border bg-secondary/50">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-foreground">1.2s</p>
                <p className="text-[10px] text-muted-foreground">Avg Latency</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">94%</p>
                <p className="text-[10px] text-muted-foreground">Accuracy</p>
              </div>
              <div>
                <p className="text-lg font-bold text-primary">{langLabel.slice(0, 2).toUpperCase()}</p>
                <p className="text-[10px] text-muted-foreground">Target</p>
              </div>
            </div>
          </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
