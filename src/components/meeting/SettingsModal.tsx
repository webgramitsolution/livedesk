import { X, Languages, Mic, Speaker, Camera, ChevronDown, Image, Activity, Volume2 } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelOverlayMode } from '@/hooks/use-mobile';
import { MobileModalShell } from './MobileModalShell';
import { SUPPORTED_LANGUAGES } from '@/lib/translation/languages';

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

interface DeviceOption {
  value: string;
  label: string;
}

/** Real device lists from the browser (labels appear once media permission was granted). */
function useMediaDevices(active: boolean) {
  const [devices, setDevices] = useState<{ audioInputs: DeviceOption[]; audioOutputs: DeviceOption[]; videoInputs: DeviceOption[] }>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const toOption = (d: MediaDeviceInfo, fallback: string, i: number): DeviceOption => ({
          value: d.deviceId || 'default',
          label: d.label || `${fallback} ${i + 1}`,
        });
        setDevices({
          audioInputs: list.filter((d) => d.kind === 'audioinput').map((d, i) => toOption(d, 'Microphone', i)),
          audioOutputs: list.filter((d) => d.kind === 'audiooutput').map((d, i) => toOption(d, 'Speaker', i)),
          videoInputs: list.filter((d) => d.kind === 'videoinput').map((d, i) => toOption(d, 'Camera', i)),
        });
      } catch {
        /* device enumeration unavailable */
      }
    };
    void load();
    navigator.mediaDevices.addEventListener?.('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', load);
    };
  }, [active]);
  return devices;
}

function SelectField({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  emptyLabel,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  options: DeviceOption[];
  onChange: (val: string) => void;
  emptyLabel?: string;
  testId?: string;
}) {
  const hasValue = options.some((o) => o.value === value);
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground sm:text-sm">
        <Icon className="w-4 h-4 text-primary" />
        {label}
      </label>
      <div className="relative">
        <select
          value={hasValue ? value : options[0]?.value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={options.length === 0}
          data-testid={testId}
          className="w-full appearance-none rounded-xl border border-input bg-background px-3 py-2 pr-9 text-sm text-foreground transition-shadow cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        >
          {options.length === 0 && <option value="">{emptyLabel ?? 'No devices found'}</option>}
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
  const isSettingsOpen = useMeetingStore((s) => s.isSettingsOpen);
  const toggleSettings = useMeetingStore((s) => s.toggleSettings);
  const selectedAudioInput = useMeetingStore((s) => s.selectedAudioInput);
  const selectedAudioOutput = useMeetingStore((s) => s.selectedAudioOutput);
  const selectedVideoInput = useMeetingStore((s) => s.selectedVideoInput);
  const setSelectedAudioOutput = useMeetingStore((s) => s.setSelectedAudioOutput);
  const selectedBackground = useMeetingStore((s) => s.selectedBackground);
  const setSelectedBackground = useMeetingStore((s) => s.setSelectedBackground);
  const showPerfHud = useMeetingStore((s) => s.showPerfHud);
  const togglePerfHud = useMeetingStore((s) => s.togglePerfHud);
  const translation = useMeetingStore((s) => s.translation);
  const setTranslation = useMeetingStore((s) => s.setTranslation);

  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayMode = usePanelOverlayMode();
  const isMobile = overlayMode === 'mobile';
  const devices = useMediaDevices(isSettingsOpen);

  // Device changes go through useWebRTC (track replacement + renegotiation).
  const selectDevices = (selection: { audioDeviceId?: string; videoDeviceId?: string }) => {
    window.dispatchEvent(new CustomEvent('livedesk:select-devices', { detail: selection }));
  };

  useEffect(() => {
    if (!isSettingsOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
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

  const languageOptions: DeviceOption[] = SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: `${l.label} (${l.nativeLabel})` }));

  const settingsBody = (
    <div className="grid gap-4 p-4 pb-6 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField icon={Mic} label="Microphone" value={selectedAudioInput} options={devices.audioInputs} onChange={(v) => selectDevices({ audioDeviceId: v })} emptyLabel="Allow microphone access to list devices" testId="settings-microphone" />
        <SelectField icon={Camera} label="Camera" value={selectedVideoInput} options={devices.videoInputs} onChange={(v) => selectDevices({ videoDeviceId: v })} emptyLabel="Allow camera access to list devices" testId="settings-camera" />
        <SelectField icon={Speaker} label="Speaker" value={selectedAudioOutput} options={devices.audioOutputs} onChange={setSelectedAudioOutput} emptyLabel="Default speaker" testId="settings-speaker" />
        <SelectField icon={Languages} label="Preferred language (what you hear)" value={translation.preferredLanguage} options={languageOptions} onChange={(v) => setTranslation({ preferredLanguage: v as typeof translation.preferredLanguage })} testId="settings-preferred-language" />
      </div>

      <div className="rounded-xl border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Live voice translation</p>
              <p className="text-xs text-muted-foreground">Other participants are translated into your preferred language.</p>
            </div>
          </div>
          <Switch checked={translation.enabled} onCheckedChange={(v) => setTranslation({ enabled: v })} data-testid="settings-translation-toggle" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            icon={Mic}
            label="Language I speak"
            value={translation.sourceLanguage}
            options={[{ value: 'auto', label: 'Same as preferred language' }, ...SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]}
            onChange={(v) => setTranslation({ sourceLanguage: v as typeof translation.sourceLanguage })}
            testId="settings-source-language"
          />
          <SelectField
            icon={Volume2}
            label="Audio for other languages"
            value={translation.audioMode}
            options={[
              { value: 'translated', label: 'Translated voice only' },
              { value: 'original', label: 'Original voice only (captions)' },
              { value: 'both', label: 'Both (original lowered)' },
            ]}
            onChange={(v) => setTranslation({ audioMode: v as typeof translation.audioMode })}
            testId="settings-audio-mode"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Image className="w-4 h-4 text-primary" /> Virtual background
        </label>
        <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
          {VIRTUAL_BACKGROUNDS.map((bg) => (
            <button
              key={bg.value}
              onClick={() => setSelectedBackground(bg.value)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border p-2 ${selectedBackground === bg.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
            >
              <span className="text-xl">{bg.preview || '⊘'}</span>
              <span className="text-[10px] leading-3 text-muted-foreground">{bg.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Activity className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Performance HUD</p>
            <p className="text-xs text-muted-foreground">FPS, packet loss, round-trip time and translation latency</p>
          </div>
        </div>
        <Switch checked={showPerfHud} onCheckedChange={togglePerfHud} />
      </div>
    </div>
  );

  if (isMobile) {
    return createPortal(
      <AnimatePresence>
        {isSettingsOpen && (
          <MobileModalShell
            title="Meeting Settings"
            ariaLabel="Meeting Settings"
            onClose={toggleSettings}
            footer={
              <motion.button whileTap={{ scale: 0.98 }} onClick={toggleSettings} className="min-h-12 w-full rounded-xl bg-primary text-sm font-display font-bold text-primary-foreground">
                Done
              </motion.button>
            }
          >
            {settingsBody}
          </MobileModalShell>
        )}
      </AnimatePresence>,
      document.body,
    );
  }

  const modal = (
    <AnimatePresence>
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="Meeting Settings">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={toggleSettings} className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            ref={dialogRef}
            style={{ borderRadius: '20px' }}
            className="relative flex flex-col overflow-hidden border border-border bg-background control-bar-elevated w-[calc(100vw-32px)] sm:w-[90vw] lg:w-full max-w-[850px] max-h-[85dvh]"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-3 sm:px-5 sm:py-4">
              <h2 className="font-display font-bold text-foreground text-lg">Meeting Settings</h2>
              <button onClick={toggleSettings} aria-label="Close settings" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">{settingsBody}</div>
            <div className="sticky bottom-0 z-10 border-t border-border bg-background px-4 py-3 sm:px-5 sm:py-4">
              <motion.button whileTap={{ scale: 0.98 }} onClick={toggleSettings} className="w-full rounded-xl bg-primary py-2.5 text-sm font-display font-bold text-primary-foreground transition-colors hover:bg-primary/90">
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
