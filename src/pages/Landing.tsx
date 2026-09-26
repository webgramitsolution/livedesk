import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Video,
  Monitor,
  PenLine,
  MousePointerClick,
  Globe,
  Users,
  ArrowRight,
  Shield,
  Mic,
  MessageCircle,
  MoreHorizontal,
  Camera,
  LogIn,
  Sparkles,
  Laptop,
  Smartphone,
} from 'lucide-react';
import { extractMeetingCodeFromInput } from '@/lib/meetingInvite';

const FEATURES = [
  { Icon: Video, title: 'Meet', text: 'HD video and crystal-clear voice.', tone: 'bg-blue-500/15 text-blue-500' },
  { Icon: Monitor, title: 'Share', text: 'Share your screen or application.', tone: 'bg-emerald-500/15 text-emerald-500' },
  { Icon: PenLine, title: 'Annotate', text: 'Draw directly on live shared content.', tone: 'bg-violet-500/15 text-violet-500' },
  { Icon: MousePointerClick, title: 'Control', text: 'Request and securely control a remote computer.', tone: 'bg-orange-500/15 text-orange-500' },
  { Icon: Globe, title: 'Translate', text: 'Speak naturally in your language.', tone: 'bg-green-500/15 text-green-500' },
];

const WAYS = [
  { Icon: Video, title: 'Talk', text: 'Video and voice communication.' },
  { Icon: Monitor, title: 'Show', text: 'Present your screen without leaving the meeting.' },
  { Icon: PenLine, title: 'Explain', text: 'Draw, circle, point and highlight live content.' },
  { Icon: MousePointerClick, title: 'Solve', text: 'Give temporary remote control when someone needs help.' },
  { Icon: Globe, title: 'Understand', text: 'Translate conversations into each participant’s preferred language.' },
];

const ACCESS = [
  { Icon: Shield, title: 'Meeting access', text: 'Control who can join.' },
  { Icon: Monitor, title: 'Screen sharing', text: 'Control who can present.' },
  { Icon: PenLine, title: 'Annotation', text: 'Give drawing access independently.' },
  { Icon: MousePointerClick, title: 'Remote control', text: 'Explicit approval required.' },
];

const LIFECYCLE = ['Meeting starts', 'Live session', 'Chat / Share / Annotate / Control', 'Meeting ends', 'Temporary session cleared'];

/** Stylised meeting preview used in the hero (no real media). */
function MeetingPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#0f172a] p-3 shadow-2xl ${compact ? 'text-[9px]' : 'text-[11px]'}`} aria-hidden="true">
      <div className="mb-2 flex items-center justify-between text-white/70">
        <span className="flex items-center gap-1.5 font-semibold text-white"><img src="/logo.png" alt="" className="h-4 w-4 rounded" /> LiveDesk <span className="font-normal text-white/50">Weekly Product Discussion</span></span>
        <span className="font-mono">00:24:18</span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="relative overflow-hidden rounded-xl bg-white p-3 text-slate-800">
          <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Product Dashboard</span><span className="rounded bg-slate-100 px-1.5 py-0.5">Q3</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 p-2"><p className="text-slate-400">Revenue</p><p className="font-bold">₹49,999</p></div>
            <div className="rounded-lg border border-slate-200 p-2"><p className="text-slate-400">Growth</p><p className="font-bold text-emerald-600">+18%</p></div>
            <div className="rounded-lg border border-slate-200 p-2"><p className="text-slate-400">Tickets</p><p className="font-bold">128</p></div>
          </div>
          <div className="mt-2 flex h-14 items-end gap-1">
            {[30, 45, 38, 60, 52, 75, 68, 90].map((h, i) => (
              <span key={i} className="flex-1 rounded-t bg-blue-500/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <ellipse cx="22" cy="38" rx="14" ry="9" fill="none" stroke="#ef4444" strokeWidth="1.2" />
            <path d="M60 30 L78 18" stroke="#ef4444" strokeWidth="1.2" fill="none" />
            <path d="M78 18 L72 19 M78 18 L77 24" stroke="#ef4444" strokeWidth="1.2" fill="none" />
          </svg>
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-full bg-slate-900/90 p-1 text-white">
            {[PenLine, MousePointerClick, Monitor].map((I, i) => <I key={i} className="h-3 w-3" />)}
          </div>
        </div>
        <div className={`flex flex-col gap-2 ${compact ? 'w-16' : 'w-24'}`}>
          {['Vikas', 'Priya', 'Rahul', 'Sara'].map((n, i) => (
            <div key={n} className={`flex aspect-video items-end rounded-lg bg-gradient-to-br ${['from-sky-500 to-indigo-600', 'from-rose-400 to-orange-500', 'from-emerald-500 to-teal-600', 'from-violet-500 to-fuchsia-600'][i]} p-1 text-white`}>
              <span className="rounded bg-black/40 px-1 text-[8px]">{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-3 text-white/70">
        {[[Mic, 'Mic'], [Camera, 'Camera'], [Monitor, 'Share'], [PenLine, 'Annotate'], [MousePointerClick, 'Control'], [MessageCircle, 'Chat'], [Users, 'People'], [MoreHorizontal, 'More']].map(([I, l]) => {
          const Icon = I as typeof Mic;
          return (
            <span key={String(l)} className="flex flex-col items-center gap-0.5"><Icon className="h-3.5 w-3.5" />{!compact && <span className="text-[8px]">{String(l)}</span>}</span>
          );
        })}
        <span className="rounded-md bg-red-500 px-2 py-0.5 text-[9px] font-bold text-white">Leave</span>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Invite links that still point at the root keep working.
  useEffect(() => {
    const code = extractMeetingCodeFromInput(params.get('meeting'));
    if (code) navigate(`/app?meeting=${encodeURIComponent(code)}`, { replace: true });
  }, [params, navigate]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#070b1a] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_20%,rgba(99,102,241,0.35),transparent_60%),radial-gradient(40%_40%_at_10%_80%,rgba(168,85,247,0.25),transparent_60%)]" aria-hidden="true" />
        <header className="relative mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
            <img src="/logo.png" alt="LiveDesk" className="h-8 w-8 rounded-lg" /> LiveDesk
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex" aria-label="Primary">
            {['Platform', 'Solutions', 'Features', 'Security', 'Pricing'].map((item) => (
              <a key={item} href={`#${item.toLowerCase()}`} className="hover:text-white">{item}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="hidden rounded-lg border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10 sm:inline-flex">Sign In</Link>
            <Link to="/app" className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold hover:bg-blue-400" data-testid="landing-start">
              <Video className="h-4 w-4" /> Start a Meeting
            </Link>
          </div>
        </header>

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pb-24 lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
              <Sparkles className="h-3.5 w-3.5" /> All-in-one meeting and remote support platform
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              Meet. <span className="bg-gradient-to-r from-sky-300 to-indigo-400 bg-clip-text text-transparent">Collaborate.</span>
              <br />
              <span className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">Control.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/75 sm:text-lg">
              Live meetings, screen sharing, collaborative annotation and secure remote support, with real-time voice translation in one workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/app" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-6 py-3 text-base font-semibold shadow-lg shadow-blue-500/30 hover:bg-blue-400">
                <Video className="h-5 w-5" /> Start a Meeting
              </Link>
              <Link to="/app" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-base font-semibold hover:bg-white/10" data-testid="landing-join">
                <Users className="h-5 w-5" /> Join a Meeting
              </Link>
            </div>
            <p className="mt-4 text-sm text-white/50">No complicated setup. Join, connect and get to work.</p>
          </div>
          <MeetingPreview />
        </div>

        {/* Feature strip */}
        <div id="platform" className="relative border-t border-white/10 bg-white text-foreground">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="flex items-center gap-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${f.tone}`}><f.Icon className="h-5 w-5" /></span>
                <div>
                  <p className="font-display font-bold">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.text}</p>
                </div>
                {i < FEATURES.length - 1 && <ArrowRight className="ml-auto hidden h-4 w-4 text-muted-foreground lg:block" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* More than a meeting */}
      <section id="features" className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More than a meeting</p>
          <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">One meeting. More ways to work.</h2>
          <ul className="mt-6 space-y-4">
            {WAYS.map((w) => (
              <li key={w.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><w.Icon className="h-4 w-4" /></span>
                <div>
                  <p className="font-semibold">{w.title}</p>
                  <p className="text-sm text-muted-foreground">{w.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <MeetingPreview />
      </section>

      {/* Three value cards */}
      <section id="solutions" className="bg-muted/40">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-14 sm:px-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-background p-6">
            <h3 className="font-display text-xl font-bold">Don’t just explain it. Show it.</h3>
            <p className="mt-2 text-sm text-muted-foreground">Point, draw, circle and highlight directly on the live presentation so everyone sees exactly what you’re talking about.</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><PenLine className="h-4 w-4 text-violet-500" /> Pen, line, arrow, rectangle, circle, eraser, undo, redo</div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-6">
            <h3 className="font-display text-xl font-bold">When talking isn’t enough. Take control.</h3>
            <p className="mt-2 text-sm text-muted-foreground">Let a participant request temporary control of your computer. You decide when access starts, and when it ends.</p>
            <div className="mt-5 rounded-xl border border-border p-3 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">Remote Control Request</p>
              <p className="mt-1 font-medium">Rahul wants to control your computer.</p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Deny</span>
                <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Allow</span>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background p-6">
            <h3 className="font-display text-xl font-bold">Everyone speaks their language.</h3>
            <p className="mt-2 text-sm text-muted-foreground">Each participant chooses their preferred language and hears the others translated in real time.</p>
            <div className="mt-5 space-y-2 text-sm">
              <div><p className="text-xs text-muted-foreground">Vikas (Hindi)</p><p className="rounded-xl bg-muted px-3 py-2">Kal meeting kitne baje hai?</p></div>
              <div><p className="text-xs text-muted-foreground">Rahul (Tamil)</p><p className="rounded-xl bg-primary/10 px-3 py-2">நாளை மீட்டிங் எத்தனை மணிக்கு?</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* Access + ephemeral */}
      <section id="security" className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border p-6">
          <h3 className="font-display text-xl font-bold">Wherever the conversation happens.</h3>
          <p className="mt-2 text-sm text-muted-foreground">Full control on desktop. A focused meeting experience on mobile.</p>
          <div className="mt-5 flex items-center gap-4 text-muted-foreground"><Laptop className="h-8 w-8" /><Smartphone className="h-8 w-8" /></div>
          <p className="mt-3 text-xs text-muted-foreground">OS-level remote control requires the LiveDesk desktop app. Browsers support meetings, sharing, annotation and translation.</p>
        </div>
        <div className="rounded-2xl border border-border p-6">
          <h3 className="font-display text-xl font-bold">You decide who gets access.</h3>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ACCESS.map((a) => (
              <li key={a.title} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><a.Icon className="h-4 w-4" /></span>
                <div><p className="text-sm font-semibold">{a.title}</p><p className="text-xs text-muted-foreground">{a.text}</p></div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-medium text-muted-foreground">Annotation never automatically grants remote control.</p>
        </div>
        <div className="rounded-2xl border border-border p-6">
          <h3 className="font-display text-xl font-bold">Meet without building a meeting archive.</h3>
          <p className="mt-2 text-sm text-muted-foreground">LiveDesk meetings are temporary sessions. Chat, annotations, participant state and other meeting data exist only for the active session and are cleared when it ends.</p>
          <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {LIFECYCLE.map((step, i) => (
              <li key={step} className="flex items-center gap-2"><span className="rounded-full bg-muted px-2 py-1">{step}</span>{i < LIFECYCLE.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Recording is optional and saved locally only when explicitly started.</p>
        </div>
      </section>

      {/* CTA */}
      <section id="pricing" className="bg-[#070b1a] text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-12 sm:px-6 md:flex-row">
          <div>
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Ready to connect?</h2>
            <p className="text-white/70">Start a meeting and experience LiveDesk.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/app" className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-3 font-semibold hover:bg-blue-400"><Video className="h-5 w-5" /> Start a Meeting</Link>
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 font-semibold hover:bg-white/10"><LogIn className="h-5 w-5" /> Sign In</Link>
          </div>
        </div>
        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-white/50 sm:px-6 md:flex-row">
            <span className="flex items-center gap-2"><img src="/logo.png" alt="" className="h-5 w-5 rounded" /> LiveDesk · Connect. Collaborate. Control.</span>
            <span>© {new Date().getFullYear()} LiveDesk. All rights reserved.</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
