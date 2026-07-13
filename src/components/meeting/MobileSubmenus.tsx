import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Activity,
  BrainCircuit,
  Plus,
  Mic,
  Camera,
  Monitor,
  Hand,
  Circle,
  MessageSquare,
  Users,
  LogOut,
  Copy,
  Check,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  Send,
  QrCode,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { MobileModalShell } from './MobileModalShell';
import { WhiteboardOverlay } from './WhiteboardOverlay';
import { useMeetingStore } from '@/store/meetingStore';
import { usePanelOverlayMode } from '@/hooks/use-mobile';
import { Switch } from '@/components/ui/switch';
import { buildMeetingLink } from '@/lib/meetingInvite';

export type MobileSubmenu =
  | 'whiteboard'
  | 'polls'
  | 'background'
  | 'stats'
  | 'about'
  | 'ai'
  | 'invite'
  | 'shortcuts'
  | 'screen-share-unsupported'
  | null;

const EVENT_NAME = 'mobile-submenu:open';

export function openMobileSubmenu(name: Exclude<MobileSubmenu, null>) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: name }));
}

const VIRTUAL_BACKGROUNDS = [
  { value: 'none', label: 'None', preview: '⊘' },
  { value: 'blur-light', label: 'Light Blur', preview: '🔵' },
  { value: 'blur-heavy', label: 'Heavy Blur', preview: '🌫️' },
  { value: 'office', label: 'Office', preview: '🏢' },
  { value: 'nature', label: 'Nature', preview: '🌿' },
  { value: 'space', label: 'Space', preview: '🌌' },
  { value: 'beach', label: 'Beach', preview: '🏖️' },
  { value: 'library', label: 'Library', preview: '📚' },
];

const SHORTCUT_ITEMS = [
  { icon: Mic, label: 'Microphone', desc: 'Mute / Unmute', key: 'M' },
  { icon: Camera, label: 'Camera', desc: 'On / Off', key: 'V' },
  { icon: Monitor, label: 'Screen Share', desc: 'Start / Stop', key: 'S' },
  { icon: Hand, label: 'Raise Hand', desc: 'Toggle', key: 'H' },
  { icon: Circle, label: 'Recording', desc: 'Start / Stop', key: 'R' },
  { icon: MessageSquare, label: 'Chat', desc: 'Open panel', key: 'C' },
  { icon: Users, label: 'Participants', desc: 'Open panel', key: 'P' },
  { icon: LogOut, label: 'Leave Meeting', desc: 'Exit', key: 'Q' },
];

/** True when running in a real mobile browser (Android / iOS user agent). */
export function isRealMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const iPadOs = /Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  return uaMobile || iPadOs;
}

/** True when viewport looks mobile but user agent is desktop (Chrome DevTools emulation). */
export function isChromeDevtoolsEmulation(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 && !isRealMobileDevice();
}

/**
 * Central mobile-only router for "More Options" submenus.
 * Ensures no centered desktop dialog opens when width < 768px — each submenu
 * is rendered as a dedicated full-screen page via MobileModalShell.
 */
export function MobileSubmenus() {
  const mode = usePanelOverlayMode();
  const [active, setActive] = useState<MobileSubmenu>(null);
  const selectedBackground = useMeetingStore((s) => s.selectedBackground);
  const setSelectedBackground = useMeetingStore((s) => s.setSelectedBackground);
  const showPerfHud = useMeetingStore((s) => s.showPerfHud);
  const togglePerfHud = useMeetingStore((s) => s.togglePerfHud);
  const setRightPanel = useMeetingStore((s) => s.setRightPanel);

  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<MobileSubmenu>).detail;
      if (mode !== 'mobile') return;
      if (name === 'ai') {
        // AI assistant already has a mobile full-screen panel via right panel system
        setRightPanel('ai');
        return;
      }
      setActive(name);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [mode, setRightPanel]);

  // Close if we leave mobile mode
  useEffect(() => {
    if (mode !== 'mobile') setActive(null);
  }, [mode]);

  if (mode !== 'mobile') return null;

  const close = () => setActive(null);

  return (
    <AnimatePresence>
      {active === 'whiteboard' && (
        <MobileModalShell key="wb" title="Whiteboard" onClose={close}>
          <div className="relative h-full min-h-[calc(100dvh-56px)] bg-muted/20">
            <WhiteboardOverlay onClose={close} />
          </div>
        </MobileModalShell>
      )}

      {active === 'polls' && (
        <MobileModalShell
          key="polls"
          title="Polls"
          onClose={close}
          footer={
            <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-display font-bold text-primary-foreground">
              <Plus className="h-4 w-4" /> Create Poll
            </button>
          }
        >
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <BarChart3 className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-display font-bold text-foreground">No Polls Yet</p>
            <p className="text-sm text-muted-foreground">Create a poll to gather quick feedback from participants.</p>
          </div>
          <div className="px-4 pb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Past Polls</p>
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          </div>
        </MobileModalShell>
      )}

      {active === 'background' && (
        <MobileModalShell key="bg" title="Virtual Background" onClose={close}>
          <div className="grid grid-cols-2 gap-3 p-4 pb-6 sm:grid-cols-3">
            {VIRTUAL_BACKGROUNDS.map((bg) => (
              <button
                key={bg.value}
                onClick={() => setSelectedBackground(bg.value)}
                className={`flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 transition-colors ${
                  selectedBackground === bg.value ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-3xl">{bg.preview}</span>
                <span className="text-xs font-medium text-foreground">{bg.label}</span>
              </button>
            ))}
          </div>
        </MobileModalShell>
      )}

      {active === 'stats' && (
        <MobileModalShell key="stats" title="Performance Stats" onClose={close}>
          <div className="p-4">
            <div className="flex items-center justify-between rounded-2xl border border-border p-4">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Performance HUD</p>
                  <p className="text-xs text-muted-foreground">Show FPS, packet loss, RTT & AI latency</p>
                </div>
              </div>
              <Switch checked={showPerfHud} onCheckedChange={togglePerfHud} />
            </div>
          </div>
        </MobileModalShell>
      )}

      {active === 'about' && (
        <MobileModalShell key="about" title="About" onClose={close}>
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <BrainCircuit className="h-7 w-7" />
              </div>
              <div>
                <p className="text-lg font-display font-bold text-foreground">ZoomConnect</p>
                <p className="text-xs text-muted-foreground">Version 1.0.0</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Real-time AI translation and collaboration for high-quality video meetings.
            </p>
            <div className="grid gap-2">
              <a className="flex min-h-12 items-center justify-between rounded-xl border border-border px-4 text-sm text-foreground" href="#">Terms of Service <span className="text-muted-foreground">›</span></a>
              <a className="flex min-h-12 items-center justify-between rounded-xl border border-border px-4 text-sm text-foreground" href="#">Privacy Policy <span className="text-muted-foreground">›</span></a>
              <a className="flex min-h-12 items-center justify-between rounded-xl border border-border px-4 text-sm text-foreground" href="#">Support <span className="text-muted-foreground">›</span></a>
            </div>
          </div>
        </MobileModalShell>
      )}
    </AnimatePresence>
  );
}