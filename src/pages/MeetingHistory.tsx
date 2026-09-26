import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isPast, isToday, parseISO } from 'date-fns';
import { Calendar, Clock, Video, Trash2, Copy, ArrowLeft, Users, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useMeetingReminders } from '@/hooks/useMeetingReminders';

interface Meeting {
  id: string;
  title: string;
  meeting_date: string;
  meeting_time: string;
  duration: string;
  meeting_code: string;
  invitees: string[] | null;
  recurrence: string | null;
}

export default function MeetingHistory() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const navigate = useNavigate();

  useMeetingReminders(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/auth?redirect=%2Fmeetings');
    });
  }, [navigate]);

  useEffect(() => {
    const fetchMeetings = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('scheduled_meetings')
        .select('*')
        .order('meeting_date', { ascending: tab === 'upcoming' });
      if (error) toast.error(error.message);
      else setMeetings(data || []);
      setLoading(false);
    };
    fetchMeetings();
  }, [tab]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('scheduled_meetings').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      setMeetings((m) => m.filter((x) => x.id !== id));
      toast.success('Meeting deleted');
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Meeting code copied');
  };

  const now = new Date();
  const filtered = meetings.filter((m) => {
    const meetingDate = parseISO(m.meeting_date);
    if (tab === 'upcoming') return !isPast(meetingDate) || isToday(meetingDate);
    return isPast(meetingDate) && !isToday(meetingDate);
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Video className="w-4 h-4 text-primary-foreground" />
          </div>
          <h1 className="font-display font-bold text-lg text-foreground">My Meetings</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {(['upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No {tab} meetings</p>
            <p className="text-sm mt-1">
              {tab === 'upcoming' ? 'Schedule a meeting from the lobby' : 'Your past meetings will appear here'}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {filtered.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-foreground truncate">{m.title}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(parseISO(m.meeting_date), 'MMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {m.meeting_time} · {m.duration}
                      </span>
                      {m.recurrence && m.recurrence !== 'none' && (
                        <span className="flex items-center gap-1">
                          <Repeat className="w-3.5 h-3.5" />
                          {m.recurrence}
                        </span>
                      )}
                      {m.invitees && m.invitees.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {m.invitees.length}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground mt-1">{m.meeting_code}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleCopy(m.meeting_code)} title="Copy code">
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(m.id)} className="text-destructive hover:text-destructive" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    {tab === 'upcoming' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const store = useMeetingStore.getState();
                          store.setUserName(store.userName || 'You');
                          store.setMeetingId(m.meeting_code);
                          store.joinMeeting();
                          navigate('/app');
                        }}
                      >
                        Join
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
