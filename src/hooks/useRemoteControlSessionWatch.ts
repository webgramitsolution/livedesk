import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { UseRemoteControlReturn } from '@/hooks/useRemoteControl';
import type { RemoteControlSessionRow } from '@/lib/permissions/api';
import { logWebRTCEvent } from '@/lib/webrtcLogger';

interface Options {
  meetingId: string;
  enabled: boolean;
  rc: UseRemoteControlReturn;
}

/**
 * Watches remote_control_sessions for the meeting. When the host (or the
 * server: expiry, participant removal, meeting end) revokes the token that is
 * active on this client, the session ends here immediately, on either side.
 */
export function useRemoteControlSessionWatch({ meetingId, enabled, rc }: Options) {
  const activeToken = rc.activeController?.nonce ?? (rc.status.state === 'controlling' ? rc.status.nonce : null);

  useEffect(() => {
    if (!enabled || !meetingId) return;
    const channel = supabase
      .channel(`rc-sessions-${meetingId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'remote_control_sessions', filter: `meeting_code=eq.${meetingId}` },
        (payload) => {
          const row = payload.new as RemoteControlSessionRow;
          if (!row || row.status === 'active') return;
          if (activeToken && row.token === activeToken) {
            logWebRTCEvent('signal', 'rc-session-revoked-remotely', { reason: row.revoke_reason });
            rc.forceEnd(row.revoke_reason ?? 'Remote control was revoked');
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, meetingId, activeToken, rc]);
}
