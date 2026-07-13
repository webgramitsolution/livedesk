import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Video, Plus, Keyboard, CalendarPlus, LogOut, Link2, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { MeetingScheduler } from './MeetingScheduler';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMeetingReminders } from '@/hooks/useMeetingReminders';
import {
  buildMeetingLink,
  clearPendingMeetingCode,
  extractMeetingCodeFromInput,
  getPendingMeetingCode,
  storePendingMeetingCode,
} from '@/lib/meetingInvite';

const CAROUSEL_SLIDES = [
  {
    title: 'Get a link that you can share',
    description: 'Click New meeting to get a link that you can send to people that you want to meet with',
  },
  {
    title: 'Plan ahead with scheduling',
    description: 'Schedule meetings in advance with date, time, and invitees — all synced to your calendar',
  },
  {
    title: 'AI-powered real-time translation',
    description: 'Speak in any language and get live translated transcription for all participants',
  },
];

export function LobbyScreen() {
  const { joinMeeting, joinExistingMeeting, setMeetingId, setUserName, setPendingJoinRequestId } = useMeetingStore();
  const [meetingCode, setMeetingCode] = useState('');
  const [showScheduler, setShowScheduler] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hasAutoJoinedRef = useRef(false);

  useMeetingReminders(Boolean(userEmail));

  const requestJoin = async (code: string, email: string | null) => {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData.session) {
      toast.error('Sign in required');
      return;
    }

    const displayName = email?.split('@')[0] || 'You';
    const db = supabase as typeof supabase & {
      from: (t: string) => {
        select: (c: string, opts?: { count?: 'exact'; head?: boolean }) => {
          eq: (c: string, v: string) => Promise<{ count: number | null; data: unknown[] | null }>;
        };
        delete: () => {
          eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<unknown> };
        };
        insert: (v: Record<string, unknown>) => {
          select: () => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
        };
      };
    };

    await db
      .from('meeting_join_requests')
      .delete()
      .eq('requester_user_id', authData.session.user.id)
      .eq('status', 'pending');

    const { count } = await db
      .from('meeting_presence')
      .select('id', { count: 'exact', head: true })
      .eq('meeting_code', code);

    if (!count || count === 0) {
      joinExistingMeeting(code, displayName);
      return;
    }

    const sessionId = crypto.randomUUID();
    const { data, error } = await db.from('meeting_join_requests').insert({
      meeting_code: code,
      requester_user_id: authData.session.user.id,
      requester_session_id: sessionId,
      display_name: displayName,
      status: 'pending',
    }).select().single();

    if (error || !data) {
      toast.error(error?.message || 'Failed to request join');
      return;
    }

    setMeetingId(code);
    setUserName(displayName);
    setPendingJoinRequestId(data.id);
    useMeetingStore.setState({ screen: 'waiting' });
  };

  useEffect(() => {
    const redirectToAuth = () => {
      // Only encode the meeting param if present, avoid nesting /auth redirects
      const meetingParam = extractMeetingCodeFromInput(searchParams.get('meeting'));
      if (meetingParam) {
        storePendingMeetingCode(meetingParam);
      }
      const redirect = meetingParam ? encodeURIComponent(`/?meeting=${meetingParam}`) : encodeURIComponent('/');
      navigate(`/auth?redirect=${redirect}`);
    };

    const maybeAutoJoin = (email: string | null) => {
      const meetingParam = extractMeetingCodeFromInput(searchParams.get('meeting')) || getPendingMeetingCode();
      if (meetingParam && !hasAutoJoinedRef.current) {
        hasAutoJoinedRef.current = true;
        clearPendingMeetingCode();
        void requestJoin(meetingParam, email);
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) {
        redirectToAuth();
        return;
      }
      const email = session.user.email ?? null;
      setUserEmail(email);
      maybeAutoJoin(email);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        redirectToAuth();
        return;
      }
      const email = session.user.email ?? null;
      setUserEmail(email);
      maybeAutoJoin(email);
    });

    return () => subscription.subscription.unsubscribe();
  }, [navigate, searchParams, joinExistingMeeting]);

  // Auto-rotate carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((s) => (s + 1) % CAROUSEL_SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const generateMeetingId = () =>
    `ZC-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 900 + 100)}`;

  const handleCreateInstant = () => {
    const id = generateMeetingId();
    setMeetingId(id);
    setUserName(userEmail?.split('@')[0] || 'You');
    joinMeeting();
    setShowNewMenu(false);
  };

  const handleCopyLink = () => {
    const id = generateMeetingId();
    const link = buildMeetingLink(id);
    navigator.clipboard.writeText(link);
    toast.success('Invite link copied', {
      description: 'Opening this link after sign-in joins directly. Meeting ID is only a backup.',
    });
    setShowNewMenu(false);
  };

  const handleJoinWithCode = () => {
    if (!meetingCode.trim()) {
      toast.error('Please enter a meeting code or link');
      return;
    }
    // Extract meeting code from link if pasted as full URL
    const code = extractMeetingCodeFromInput(meetingCode.trim()) || meetingCode.trim();
    void requestJoin(code, userEmail);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success('Signed out');
    navigate('/auth');
  };

  return (
    <div className="h-screen flex flex-col bg-background relative">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Video className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg text-foreground hidden sm:block">Zoom Connect</span>
        </div>
        {userEmail && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => navigate('/meetings')}>
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">My Meetings</span>
            </Button>
            <span className="text-xs text-muted-foreground hidden sm:block">{userEmail}</span>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSignOut}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </motion.button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12 lg:gap-16 px-4 sm:px-8 py-8">
        {/* Left - Actions */}
        <div className="flex flex-col items-center md:items-start gap-6 w-full max-w-md md:max-w-lg">
          {extractMeetingCodeFromInput(searchParams.get('meeting')) && (
            <div className="w-full rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left">
              <p className="font-display text-base font-bold text-foreground">You opened an invite link</p>
              <p className="mt-1 text-sm text-muted-foreground">
                After sign-in, joining is direct on mobile too — no need to type the Meeting ID again unless the link was copied manually.
              </p>
              <p className="mt-2 font-mono text-xs text-primary">
                {extractMeetingCodeFromInput(searchParams.get('meeting'))}
              </p>
            </div>
          )}

          <div className="text-center md:text-left">
            <h1 className="font-display font-bold text-2xl sm:text-4xl md:text-4xl text-foreground leading-tight md:max-w-[18ch] lg:max-w-none">
              Video calls and meetings for everyone
            </h1>
            <p className="text-muted-foreground mt-3 text-sm sm:text-base">
              Connect, collaborate and celebrate from anywhere with Zoom Connect
            </p>
          </div>

          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 w-full">
            {/* New Meeting Button */}
            <div className="relative">
              <Button
                onClick={() => setShowNewMenu(!showNewMenu)}
                className="gap-2 rounded-xl px-6 py-3 h-auto font-display font-bold text-base w-full lg:w-auto"
              >
                <Plus className="w-5 h-5" />
                New meeting
              </Button>
              <AnimatePresence>
                {showNewMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    className="absolute left-0 top-full mt-2 w-56 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden"
                  >
                    <button
                      onClick={handleCreateInstant}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <Video className="w-4 h-4 text-primary" />
                      Start an instant meeting
                    </button>
                    <button
                      onClick={handleCopyLink}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <Link2 className="w-4 h-4 text-primary" />
                      Create a meeting link
                    </button>
                    <button
                      onClick={() => { setShowScheduler(true); setShowNewMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <CalendarPlus className="w-4 h-4 text-primary" />
                      Schedule a meeting
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Join with code */}
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={meetingCode}
                  onChange={(e) => setMeetingCode(e.target.value)}
                  placeholder="Enter a code or link"
                  className="pl-10 rounded-xl h-12 font-mono text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinWithCode()}
                />
              </div>
              <Button
                variant="ghost"
                onClick={handleJoinWithCode}
                disabled={!meetingCode.trim()}
                className="text-primary font-display font-bold h-12 px-4"
              >
                Join
              </Button>
            </div>
          </div>
        </div>

        {/* Right - Carousel */}
        <div className="flex flex-col items-center gap-4 max-w-sm w-full">
          <div className="w-64 h-64 sm:w-72 sm:h-72 rounded-full bg-muted flex items-center justify-center relative overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSlide}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center text-center p-8"
              >
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  {currentSlide === 0 && <Link2 className="w-8 h-8 text-primary" />}
                  {currentSlide === 1 && <CalendarPlus className="w-8 h-8 text-primary" />}
                  {currentSlide === 2 && <Video className="w-8 h-8 text-primary" />}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Slide text */}
          <div className="text-center">
            <h3 className="font-display font-bold text-foreground text-lg">
              {CAROUSEL_SLIDES[currentSlide].title}
            </h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-xs mx-auto">
              {CAROUSEL_SLIDES[currentSlide].description}
            </p>
          </div>

          {/* Carousel controls */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentSlide((s) => (s - 1 + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length)}
              className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex gap-1.5">
              {CAROUSEL_SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  className={`w-2 h-2 rounded-full transition-colors ${i === currentSlide ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                />
              ))}
            </div>
            <button
              onClick={() => setCurrentSlide((s) => (s + 1) % CAROUSEL_SLIDES.length)}
              className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </main>

      {/* Close dropdown when clicking outside */}
      {showNewMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
      )}

      <MeetingScheduler isOpen={showScheduler} onClose={() => setShowScheduler(false)} />
    </div>
  );
}
