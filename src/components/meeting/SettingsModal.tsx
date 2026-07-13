import { X, Languages, Mic, Speaker, Camera, Brain, ChevronDown, Image, Activity } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'zh', label: 'Chinese (Mandarin)' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'hi', label: 'Hindi' },
];

const AUDIO_INPUTS = [
  { value: 'default', label: 'Default Microphone' },
  { value: 'built-in', label: 'Built-in Microphone' },
  { value: 'headset', label: 'Headset Microphone' },
  { value: 'usb', label: 'USB Condenser Mic' },
];

const AUDIO_OUTPUTS = [
  { value: 'default', label: 'Default Speaker' },
  { value: 'built-in', label: 'Built-in Speakers' },
  { value: 'headphones', label: 'Headphones' },
  { value: 'bluetooth', label: 'Bluetooth Audio' },
];

const VIDEO_INPUTS = [
  { value: 'default', label: 'Default Camera' },
  { value: 'built-in', label: 'Built-in Webcam' },
  { value: 'external', label: 'External USB Camera' },
  { value: 'virtual', label: 'Virtual Camera' },
];

const AI_MODELS = [
  { value: 'whisper-tiny', label: 'Whisper Tiny (q4)', desc: 'Fastest · ~150MB RAM · Good accuracy' },
  { value: 'whisper-base', label: 'Whisper Base (q4)', desc: 'Balanced · ~300MB RAM · Better accuracy' },
  { value: 'whisper-small', label: 'Whisper Small (q8)', desc: 'Slower · ~600MB RAM · Best accuracy' },
];

const VIRTUAL_BACKGROUNDS = [
  { value: 'none', label: 'None', preview: '' },
  { value: 'blur-light', label: 'Light Blur', preview: '🔵' },
  { value: 'blur-heavy', label: 'Heavy Blur', preview: '🌫️' },
  { value: 'office', label: 'Office', preview: '🏢' },
  { value: 'nature', label: 'Nature', preview: '🌿' },
  { value: 'space', label: 'Space', preview: '🌌' },
  { value: 'beach', label: 'Beach', preview: '🏖️' },
  { value: 'library', label: 'Library', preview: '📚' },
];

function SelectField({
  icon: Icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground sm:text-sm">
        <Icon className="w-4 h-4 text-primary" />
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-input bg-background px-3 py-2 pr-9 text-sm text-foreground transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
}

export function SettingsModal() {
  const {
    isSettingsOpen, toggleSettings,
    selectedLanguage, setSelectedLanguage,
    selectedAudioInput, setSelectedAudioInput,
    selectedAudioOutput, setSelectedAudioOutput,
    selectedVideoInput, setSelectedVideoInput,
    selectedAiModel, setSelectedAiModel,
    selectedBackground, setSelectedBackground,
    showPerfHud, togglePerfHud,
  } = useMeetingStore();

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); toggleSettings(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [isSettingsOpen, toggleSettings]);

  if (typeof document === 'undefined') return null;

  const modal = (
    <AnimatePresence>
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Meeting Settings"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleSettings}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            ref={dialogRef}
            style={{ borderRadius: '20px' }}
            className="relative flex flex-col overflow-hidden border border-border bg-background control-bar-elevated w-[calc(100vw-32px)] sm:w-[90vw] lg:w-full max-w-[850px] max-h-[85dvh]"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3 sm:px-5 sm:py-4">
              <h2 className="font-display font-bold text-foreground text-lg">Meeting Settings</h2>
              <button
                onClick={toggleSettings}
                aria-label="Close settings"
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-3 lg:gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
                <SelectField
                  icon={Languages}
                  label="Translation Language"
                  value={selectedLanguage}
                  options={LANGUAGES}
                  onChange={setSelectedLanguage}
                />

                <SelectField
                  icon={Mic}
                  label="Microphone"
                  value={selectedAudioInput}
                  options={AUDIO_INPUTS}
                  onChange={setSelectedAudioInput}
                />

                <SelectField
                  icon={Speaker}
                  label="Speaker"
                  value={selectedAudioOutput}
                  options={AUDIO_OUTPUTS}
                  onChange={setSelectedAudioOutput}
                />

                <SelectField
                  icon={Camera}
                  label="Camera"
                  value={selectedVideoInput}
                  options={VIDEO_INPUTS}
                  onChange={setSelectedVideoInput}
                />
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground sm:text-sm">
                    <Brain className="w-4 h-4 text-primary" />
                    AI Model
                  </label>
                  <div className="grid gap-2 lg:grid-cols-3">
                    {AI_MODELS.map((model) => (
                      <motion.button
                        key={model.value}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedAiModel(model.value)}
                        className={`w-full rounded-xl border p-2.5 text-left transition-colors ${
                          selectedAiModel === model.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <p className={`text-sm font-medium ${
                          selectedAiModel === model.value ? 'text-primary' : 'text-foreground'
                        }`}>
                          {model.label}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{model.desc}</p>
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground sm:text-sm">
                    <Image className="w-4 h-4 text-primary" />
                    Virtual Background
                  </label>
                  <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
                    {VIRTUAL_BACKGROUNDS.map((bg) => (
                      <motion.button
                        key={bg.value}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedBackground(bg.value)}
                        className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center transition-colors ${
                          selectedBackground === bg.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-xl">{bg.preview || '⊘'}</span>
                        <span className="text-[9px] leading-3 text-muted-foreground">{bg.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border px-3 py-3 sm:px-4">
                  <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Performance HUD</p>
                      <p className="text-xs text-muted-foreground">Show live FPS, packet loss & AI latency (1.5s target)</p>
                    </div>
                  </div>
                  <Switch checked={showPerfHud} onCheckedChange={togglePerfHud} />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 z-10 border-t border-border bg-background px-4 py-3 sm:px-5 sm:py-4">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={toggleSettings}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-display font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}
