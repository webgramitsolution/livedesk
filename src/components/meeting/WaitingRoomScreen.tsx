import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Hourglass, CheckCircle2, CircleX, TimerReset } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function WaitingRoomScreen() {
  const meetingId = useMeetingStore((s) => s.meetingId);
  const userName = useMeetingStore((s) => s.userName);
  const pendingJoinRequestId = useMeetingStore((s) => s.pendingJoinRequestId);
  const setPendingJoinRequestId = useMeetingStore((s) => s.setPendingJoinRequestId);
  const leaveMeeting = useMeetingStore((s) => s.leaveMeeting);
  const cleanupRef = useRef<() => void>();
  const joinExistingMeeting = useMeetingStore((s) => s.joinExistingMeeting);

  useEffect(() => {
    if (!pendingJoinRequestId || !meetingId) return;
    const channel = supabase
      .channel(`join-request-${pendingJoinRequestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_join_requests', filter: `id=eq.${pendingJoinRequestId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            toast.error('Join request expired. Please request again.');
            setPendingJoinRequestId(null);
            leaveMeeting();
            return;
          }

          const next = payload.new as { status?: string; expires_at?: string };
          const status = next.status;
          if (status === 'approved') {
            toast.success('Host admitted you. Joining…');
            setPendingJoinRequestId(null);
            joinExistingMeeting(meetingId, userName || 'You');
          } else if (status === 'denied') {
            toast.error('Host declined your request');
            setPendingJoinRequestId(null);
            leaveMeeting();
          } else if (status === 'pending' && next.expires_at && new Date(next.expires_at).getTime() <= Date.now()) {
            toast.error('Join request expired. Please request again.');
            setPendingJoinRequestId(null);
            leaveMeeting();
          }
        }
      )
      .subscribe();

    cleanupRef.current = () => { supabase.removeChannel(channel); };
    return () => cleanupRef.current?.();
  }, [pendingJoinRequestId, meetingId, setPendingJoinRequestId, leaveMeeting, joinExistingMeeting, userName]);

  const handleCancel = async () => {
    if (pendingJoinRequestId) {
      const db = supabase as typeof supabase & {
        from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<unknown> } };
      };
      await db.from('meeting_join_requests').delete().eq('id', pendingJoinRequestId);
    }
    setPendingJoinRequestId(null);
    leaveMeeting();
  };

  const statusCard = [
    {
      icon: Hourglass,
      title: 'Pending approval',
      detail: 'Your request is in the host queue.',
      tone: 'bg-primary/5 border-primary/20 text-primary',
    },
    {
      icon: CheckCircle2,
      title: 'Auto-join ready',
      detail: 'You will enter instantly after host approval.',
      tone: 'bg-success/5 border-success/20 text-success',
    },
    {
      icon: TimerReset,
      title: 'Old requests removed',
      detail: 'Expired pending requests are cleared automatically.',
      tone: 'bg-secondary border-border text-foreground',
    },
  ];

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background gap-6 px-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center"
      >
        <Hourglass className="w-8 h-8 text-primary" />
      </motion.div>
      <div className="text-center max-w-sm">
        <h2 className="font-display font-bold text-foreground text-xl">Waiting for the host…</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Hi {userName || 'there'} — the host has been notified that you'd like to join {meetingId}. You'll enter as soon as they admit you.
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-3 sm:grid-cols-3">
        {statusCard.map((item) => (
          <div key={item.title} className={`rounded-2xl border p-3 text-left ${item.tone}`}>
            <item.icon className="mb-2 h-5 w-5" />
            <p className="text-sm font-semibold">{item.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      <div className="flex items-center gap-3">
        <button
          onClick={handleCancel}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
          <CircleX className="h-3.5 w-3.5" />
          Deny or expiry sends you back automatically
        </div>
      </div>
    </div>
  );
}