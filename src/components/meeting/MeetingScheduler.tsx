import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalendarIcon, Clock, X, Send, Copy, Plus, Trash2, Users, Repeat } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { buildMeetingLink } from '@/lib/meetingInvite';

interface ScheduledMeeting {
  id: string;
  title: string;
  date: Date;
  time: string;
  duration: string;
  invitees: string[];
  meetingId: string;
  recurrence: string;
}

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
];

const DURATIONS = ['15 min', '30 min', '45 min', '1 hour', '1.5 hours', '2 hours'];
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

export function MeetingScheduler({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('30 min');
  const [title, setTitle] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [view, setView] = useState<'schedule' | 'list'>('schedule');
  const [recurrence, setRecurrence] = useState('none');
  const [loading, setLoading] = useState(false);

  const fetchMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from('scheduled_meetings')
      .select('*')
      .order('meeting_date', { ascending: true });

    if (!error && data) {
      setMeetings(data.map((m: any) => ({
        id: m.id,
        title: m.title,
        date: new Date(m.meeting_date),
        time: m.meeting_time,
        duration: m.duration,
        invitees: m.invitees || [],
        meetingId: m.meeting_code,
        recurrence: m.recurrence || 'none',
      })));
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchMeetings();
  }, [isOpen, fetchMeetings]);

  const generateMeetingId = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const seg = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}`;
  };

  const addInvitee = () => {
    const email = inviteeEmail.trim();
    if (email && email.includes('@') && !invitees.includes(email)) {
      setInvitees([...invitees, email]);
      setInviteeEmail('');
    }
  };

  const removeInvitee = (email: string) => {
    setInvitees(invitees.filter(e => e !== email));
  };

  const scheduleMeeting = async () => {
    if (!date || !title.trim()) {
      toast.error('Please provide a title and select a date');
      return;
    }
    setLoading(true);
    const meetingCode = generateMeetingId();
    const meetingLink = buildMeetingLink(meetingCode);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Please sign in to schedule meetings');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('scheduled_meetings').insert({
      title: title.trim(),
      meeting_date: format(date, 'yyyy-MM-dd'),
      meeting_time: time,
      duration,
      meeting_code: meetingCode,
      invitees: [...invitees],
      recurrence,
      user_id: session.user.id,
    } as any);

    if (error) {
      toast.error('Failed to schedule meeting');
      setLoading(false);
      return;
    }

    toast.success('Meeting scheduled!', { description: `${title} on ${format(date, 'PPP')} at ${time}` });

    if (invitees.length > 0) {
      const recLabel = RECURRENCE_OPTIONS.find(r => r.value === recurrence)?.label || '';
      const subject = encodeURIComponent(`Meeting Invite: ${title}`);
      const body = encodeURIComponent(
        `You're invited to "${title}"\n\nDate: ${format(date, 'PPP')}\nTime: ${time}\nDuration: ${duration}${recurrence !== 'none' ? `\nRepeats: ${recLabel}` : ''}\n\nDirect join link: ${meetingLink}\nBackup Meeting ID: ${meetingCode}\n\nOpen the link on phone or desktop, sign in, and you'll join directly.`
      );
      window.open(`mailto:${invitees.join(',')}?subject=${subject}&body=${body}`, '_blank');
    }

    // Add to Google Calendar
    const startDate = format(date, 'yyyyMMdd');
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startDate}T${time.replace(':', '')}00/${startDate}T${time.replace(':', '')}00&details=${encodeURIComponent(`Direct join: ${meetingLink}\nBackup Meeting ID: ${meetingCode}`)}`;
    window.open(gcalUrl, '_blank');

    setTitle('');
    setDate(undefined);
    setTime('10:00');
    setDuration('30 min');
    setInvitees([]);
    setRecurrence('none');
    setLoading(false);
    fetchMeetings();
    setView('list');
  };

  const copyMeetingLink = (meetingId: string) => {
    navigator.clipboard.writeText(buildMeetingLink(meetingId));
    toast.success('Meeting link copied!');
  };

  const deleteMeeting = async (id: string) => {
    await supabase.from('scheduled_meetings').delete().eq('id', id);
    setMeetings(meetings.filter(m => m.id !== id));
    toast.success('Meeting cancelled');
  };

  const shareMeeting = async (meetingId: string, titleText: string) => {
    const meetingLink = buildMeetingLink(meetingId);
    const shareText = `Join \"${titleText}\" using this link: ${meetingLink}\nBackup Meeting ID: ${meetingId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${titleText}`,
          text: shareText,
          url: meetingLink,
        });
        return;
      } catch {
        return;
      }
    }

    navigator.clipboard.writeText(meetingLink);
    toast.success('Meeting link copied for sharing');
  };

  const shareOnWhatsApp = (meetingId: string, titleText: string) => {
    const meetingLink = buildMeetingLink(meetingId);
    const message = encodeURIComponent(`Join \"${titleText}\" directly: ${meetingLink}\nBackup Meeting ID: ${meetingId}`);
    window.open(`https://wa.me/?text=${message}`, '_blank', 'noopener,noreferrer');
  };

  const addToGoogleCalendar = (m: ScheduledMeeting) => {
    const startDate = format(m.date, 'yyyyMMdd');
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(m.title)}&dates=${startDate}T${m.time.replace(':', '')}00/${startDate}T${m.time.replace(':', '')}00&details=${encodeURIComponent(`Meeting ID: ${m.meetingId}\nJoin: ${window.location.origin}?meeting=${m.meetingId}`)}`;
    window.open(gcalUrl, '_blank');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CalendarIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-foreground text-lg">Schedule Meeting</h2>
                  <p className="text-xs text-muted-foreground">Plan ahead and send invites</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setView('schedule')}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${view === 'schedule' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                New Meeting
              </button>
              <button
                onClick={() => setView('list')}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${view === 'list' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Scheduled ({meetings.length})
              </button>
            </div>

            <div className="overflow-y-auto max-h-[60vh] p-5">
              {view === 'schedule' ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Meeting Title</label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q1 Planning Review" className="bg-secondary border-border" />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {date ? format(date, 'PPP') : 'Pick a date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={date} onSelect={setDate} disabled={(d) => d < new Date()} initialFocus className={cn('p-3 pointer-events-auto')} />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Time</label>
                      <select value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-10 px-3 rounded-md border border-border bg-secondary text-sm text-foreground">
                        {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Duration</label>
                      <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full h-10 px-3 rounded-md border border-border bg-secondary text-sm text-foreground">
                        {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Recurrence */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      <Repeat className="w-3.5 h-3.5 inline mr-1" />
                      Repeat
                    </label>
                    <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full h-10 px-3 rounded-md border border-border bg-secondary text-sm text-foreground">
                      {RECURRENCE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>

                  {/* Invitees */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Invite Participants</label>
                    <div className="flex gap-2">
                      <Input value={inviteeEmail} onChange={(e) => setInviteeEmail(e.target.value)} placeholder="email@example.com" className="bg-secondary border-border" onKeyDown={(e) => e.key === 'Enter' && addInvitee()} />
                      <Button variant="outline" size="icon" onClick={addInvitee}><Plus className="w-4 h-4" /></Button>
                    </div>
                    {invitees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {invitees.map(email => (
                          <span key={email} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                            {email}
                            <button onClick={() => removeInvitee(email)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Invitees can open the link and join directly after sign-in. Meeting ID is just a fallback.
                    </p>
                  </div>

                  <Button onClick={scheduleMeeting} className="w-full gap-2" disabled={loading}>
                    <Send className="w-4 h-4" />
                    {loading ? 'Scheduling...' : 'Schedule & Send Invites'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {meetings.length === 0 ? (
                    <div className="text-center py-8">
                      <CalendarIcon className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No meetings scheduled yet</p>
                    </div>
                  ) : (
                    meetings.map((m) => (
                      <div key={m.id} className="border border-border rounded-xl p-4 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-medium text-foreground text-sm">{m.title}</h3>
                            <p className="text-xs text-muted-foreground">
                              {format(m.date, 'PPP')} at {m.time} · {m.duration}
                            </p>
                            {m.recurrence !== 'none' && (
                              <span className="inline-flex items-center gap-1 text-xs text-primary mt-0.5">
                                <Repeat className="w-3 h-3" />
                                {RECURRENCE_OPTIONS.find(r => r.value === m.recurrence)?.label}
                              </span>
                            )}
                          </div>
                          <button onClick={() => deleteMeeting(m.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Users className="w-3.5 h-3.5" />
                          <span>{m.invitees.length} invited</span>
                          <span className="font-mono bg-secondary px-2 py-0.5 rounded">{m.meetingId}</span>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => copyMeetingLink(m.meetingId)}>
                            <Copy className="w-3 h-3" /> Copy Link
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => shareMeeting(m.meetingId, m.title)}>
                            <Send className="w-3 h-3" /> Share
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => shareOnWhatsApp(m.meetingId, m.title)}>
                            <Users className="w-3 h-3" /> WhatsApp
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => addToGoogleCalendar(m)}>
                            <CalendarIcon className="w-3 h-3" /> Google Cal
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => {
                            const subject = encodeURIComponent(`Meeting Invite: ${m.title}`);
                            const body = encodeURIComponent(`Join "${m.title}" on ${format(m.date, 'PPP')} at ${m.time}\nDirect join: ${buildMeetingLink(m.meetingId)}\nBackup Meeting ID: ${m.meetingId}`);
                            window.open(`mailto:${m.invitees.join(',')}?subject=${subject}&body=${body}`, '_blank');
                          }}>
                            <Send className="w-3 h-3" /> Resend
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
