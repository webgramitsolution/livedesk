import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';
import { toast } from 'sonner';

interface JoinRequest {
  id: string;
  display_name: string;
  status: string;
  meeting_code: string;
  expires_at: string;
}

export function JoinRequestNotifier() {
  const meetingId = useMeetingStore((s) => s.meetingId);
  const screen = useMeetingStore((s) => s.screen);
  const [pending, setPending] = useState<JoinRequest[]>([]);

  useEffect(() => {
    if (screen !== 'meeting' || !meetingId) return;

    const refresh = async () => {
      const db = supabase as typeof supabase & {
        from: (t: string) => {
          delete: () => { lt: (c: string, v: string) => { eq: (c: string, v: string) => Promise<unknown> } };
          select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: JoinRequest[] | null }> } };
        };
      };
      await db.from('meeting_join_requests').delete().lt('expires_at', new Date().toISOString()).eq('status', 'pending');
      const { data } = await db
        .from('meeting_join_requests')
        .select('id,display_name,status,meeting_code,expires_at')
        .eq('meeting_code', meetingId)
        .eq('status', 'pending');
      setPending(data || []);
    };

    refresh();

    const channel = supabase
      .channel(`join-requests-${meetingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_join_requests', filter: `meeting_code=eq.${meetingId}` },
        () => refresh()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [screen, meetingId]);

  const decide = async (id: string, status: 'approved' | 'denied', name: string) => {
    const db = supabase as typeof supabase & {
      from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } };
    };
    const { error } = await db
      .from('meeting_join_requests')
      .update({ status, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === 'approved' ? `Admitted ${name}` : `Declined ${name}`);
  };

  return (
    <div className="pointer-events-none fixed top-16 right-2 sm:right-4 z-[70] flex flex-col gap-2 max-w-[calc(100vw-1rem)] sm:max-w-xs">
      <AnimatePresence>
        {pending.map((req) => (
          <motion.div
            key={req.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-md"
          >
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{req.display_name}</p>
                <p className="text-[11px] text-muted-foreground">wants to join</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => decide(req.id, 'approved', req.display_name)}
                className="flex-1 flex items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
              >
                <Check className="w-3.5 h-3.5" /> Admit
              </button>
              <button
                onClick={() => decide(req.id, 'denied', req.display_name)}
                className="flex-1 flex items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted"
              >
                <X className="w-3.5 h-3.5" /> Deny
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}