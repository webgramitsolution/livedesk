import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video, Bell, Link as LinkIcon, Calendar, MonitorUp, Clock, Users,
  Home, CalendarDays, Plus, MessageSquare, User, LogOut, CalendarPlus, MoreVertical,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { MeetingScheduler } from './MeetingScheduler';
import { supabase } from '@/integrations/supabase/client';

type Props = {
  userEmail: string | null;
  meetingCode: string;
  setMeetingCode: (v: string) => void;
  onCreateInstant: () => void;
  onJoinWithCode: () => void;
  onSignOut: () => void;
};

export function MobileLobbyScreen({
  userEmail, meetingCode, setMeetingCode, onCreateInstant, onJoinWithCode, onSignOut,
}: Props) {
  const navigate = useNavigate();
  const [showScheduler, setShowScheduler] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const initial = (userEmail?.[0] || 'U').toUpperCase();

  const quickActions = [
    { icon: Calendar, label: 'Schedule', sub: 'Plan your meeting', color: 'bg-primary/10 text-primary', onClick: () => setShowScheduler(true) },
    { icon: MonitorUp, label: 'Share Screen', sub: 'Present to others', color: 'bg-emerald-500/10 text-emerald-600', onClick: onCreateInstant },
    { icon: Clock, label: 'History', sub: 'View past meetings', color: 'bg-violet-500/10 text-violet-600', onClick: () => navigate('/meetings') },
    { icon: Users, label: 'Contacts', sub: 'Connect with people', color: 'bg-orange-500/10 text-orange-600', onClick: () => toast.info('Contacts coming soon') },
  ];

  return (
    <div className="min-h-dvh bg-[hsl(210_20%_98%)] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur-md px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="LiveDesk logo" className="w-10 h-10 rounded-xl object-contain shadow-sm" />
          <span className="font-display font-bold text-lg text-foreground">LiveDesk</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            aria-label="Notifications"
            className="relative w-10 h-10 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          >
            <Bell className="w-5 h-5 text-foreground" />
            <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-destructive" />
          </button>
          <button
            aria-label="Profile"
            onClick={() => setShowProfile((s) => !s)}
            className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-display font-bold text-primary text-sm"
          >
            {initial}
          </button>
        </div>
      </header>

      {showProfile && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowProfile(false)} />
          <div className="absolute right-5 top-16 z-40 w-56 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{userEmail}</p>
            </div>
            <button
              onClick={() => { setShowProfile(false); onSignOut(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </>
      )}

      <main className="mx-auto w-full max-w-[420px] px-5 space-y-5 pt-2">
        {/* Hero Card */}
        <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-primary/5 via-background to-primary/10 border border-border/60 shadow-sm p-5">
          <div className="relative z-10 max-w-[70%]">
            <h1 className="font-display font-bold text-[26px] leading-[1.15] text-foreground">
              Ready for your<br />next meeting?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Start, join or schedule meetings instantly.
            </p>
            <Button
              onClick={onCreateInstant}
              className="mt-5 h-[54px] rounded-[14px] px-6 font-display font-bold text-base gap-2 shadow-md shadow-primary/30"
            >
              <Video className="w-5 h-5" />
              New Meeting
            </Button>
          </div>
          {/* Decorative illustration */}
          <div aria-hidden className="pointer-events-none absolute right-0 top-4 opacity-70">
            <div className="relative w-28 h-28">
              <div className="absolute right-2 top-2 w-14 h-14 rounded-2xl bg-primary/15" />
              <div className="absolute right-8 bottom-2 w-10 h-10 rounded-full bg-primary/25" />
              <div className="absolute right-16 bottom-0 w-8 h-8 rounded-full bg-primary/35" />
            </div>
          </div>

          {/* Join card inside hero */}
          <div className="relative z-10 mt-5 rounded-[14px] bg-background border border-border/70 shadow-sm p-2 flex items-center gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onJoinWithCode()}
                placeholder="Meeting ID or Link"
                aria-label="Meeting ID or Link"
                className="pl-9 h-11 border-0 shadow-none focus-visible:ring-0 text-sm bg-transparent"
              />
            </div>
            <Button
              variant="ghost"
              onClick={onJoinWithCode}
              disabled={!meetingCode.trim()}
              className="h-11 px-5 rounded-[10px] bg-primary/10 text-primary hover:bg-primary/15 font-display font-bold"
            >
              Join
            </Button>
          </div>
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="font-display font-bold text-lg text-foreground mb-3">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((a) => (
              <motion.button
                key={a.label}
                whileTap={{ scale: 0.97 }}
                onClick={a.onClick}
                className="rounded-[16px] bg-background border border-border/70 shadow-sm p-3.5 flex items-center gap-3 text-left"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.color}`}>
                  <a.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-display font-bold text-sm text-foreground truncate">{a.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{a.sub}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        {/* Upcoming meeting */}
        <section className="rounded-[18px] bg-primary/5 border border-primary/15 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-display font-bold text-sm text-primary">Upcoming meeting</p>
            <button
              onClick={() => navigate('/meetings')}
              className="text-xs text-primary font-medium hover:underline"
            >
              View all
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <CalendarPlus className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-sm text-foreground truncate">Team Standup</p>
              <p className="text-xs text-muted-foreground truncate">Today • 10:30 – 11:00 AM</p>
            </div>
            <Button
              variant="ghost"
              onClick={() => setShowScheduler(true)}
              className="h-9 px-3 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 font-display font-bold text-sm"
            >
              Join
            </Button>
          </div>
        </section>

        {/* Recent meetings */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-lg text-foreground">Recent meetings</h2>
            <button
              onClick={() => navigate('/meetings')}
              className="text-xs text-primary font-medium hover:underline"
            >
              View all
            </button>
          </div>
          <div className="rounded-[16px] bg-background border border-border/70 shadow-sm divide-y divide-border/60">
            {[
              { i: 'D', name: 'Design Review', time: 'Today • 09:00 AM', color: 'bg-violet-500/15 text-violet-600' },
              { i: 'C', name: 'Client Discussion', time: 'Yesterday • 04:30 PM', color: 'bg-emerald-500/15 text-emerald-600' },
            ].map((m) => (
              <div key={m.name} className="flex items-center gap-3 p-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-sm ${m.color}`}>
                  {m.i}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-sm text-foreground truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.time}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => navigate('/meetings')}
                  className="h-8 px-3 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 font-display font-bold text-xs"
                >
                  Join
                </Button>
                <button aria-label="More options" className="w-8 h-8 flex items-center justify-center text-muted-foreground">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Bottom Navigation */}
      <nav
        aria-label="Primary"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-24px)] max-w-[420px]"
      >
        <div className="relative bg-background/85 backdrop-blur-xl border border-border/70 rounded-[24px] shadow-lg px-2 py-1.5 flex items-center justify-around">
          <NavItem icon={Home} label="Home" active />
          <NavItem icon={CalendarDays} label="Meetings" onClick={() => navigate('/meetings')} />
          <button
            aria-label="New meeting"
            onClick={onCreateInstant}
            className="w-14 h-14 -mt-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 border-4 border-background"
          >
            <Plus className="w-6 h-6" />
          </button>
          <NavItem icon={MessageSquare} label="Chat" onClick={() => toast.info('Chat coming soon')} />
          <NavItem icon={User} label="Profile" onClick={() => setShowProfile(true)} />
        </div>
      </nav>

      <MeetingScheduler isOpen={showScheduler} onClose={() => setShowScheduler(false)} />
    </div>
  );
}

function NavItem({
  icon: Icon, label, active, onClick,
}: { icon: typeof Home; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}