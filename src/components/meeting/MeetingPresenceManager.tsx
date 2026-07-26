import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore, type Participant } from '@/store/meetingStore';
import { toast } from 'sonner';
import { logWebRTCEvent } from '@/lib/webrtcLogger';

type PresenceRow = {
  display_name: string;
  is_camera_on: boolean;
  is_mic_on: boolean;
  joined_at: string;
  meeting_code: string;
  session_id: string;
};

const TABLE = 'meeting_presence';

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';

const playParticipantTone = () => {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    osc.frequency.setValueAtTime(1040, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.32);
  } catch {
    return;
  }
};

export function MeetingPresenceManager() {
  const meetingId = useMeetingStore((s) => s.meetingId);
  const meetingSessionId = useMeetingStore((s) => s.meetingSessionId);
  const screen = useMeetingStore((s) => s.screen);
  const userName = useMeetingStore((s) => s.userName);
  const isMicOn = useMeetingStore((s) => s.isMicOn);
  const isCameraOn = useMeetingStore((s) => s.isCameraOn);

  const fallbackSessionIdRef = useRef(`session-${crypto.randomUUID()}`);
  const previousRemoteIdsRef = useRef<string[]>([]);
  const localSessionId = useMemo(() => meetingSessionId || fallbackSessionIdRef.current, [meetingSessionId]);

  useEffect(() => {
    if (screen !== 'meeting' || !meetingId) return;

    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const mapParticipants = (rows: PresenceRow[], localSessionId: string) => {
      const current = useMeetingStore.getState().participants;
      const currentById = new Map(current.map((participant) => [participant.id, participant]));

      return rows
        .map((row): Participant => {
          const id = row.session_id === localSessionId ? '1' : row.session_id;
          const previous = currentById.get(id);
          return {
            id,
            name: row.display_name,
            isMuted: !row.is_mic_on,
            isCameraOn: row.is_camera_on,
            isSpeaking: previous?.isSpeaking ?? false,
            hasMouseControl: previous?.hasMouseControl ?? false,
            mouseControlRequested: previous?.mouseControlRequested ?? false,
            handRaised: previous?.handRaised ?? false,
            handRaisedAt: previous?.handRaisedAt ?? null,
            avatar: getInitials(row.display_name),
            spokenLanguage: previous?.spokenLanguage ?? 'en',
          };
        })
        .sort((a, b) => (a.id === '1' ? -1 : b.id === '1' ? 1 : 0));
    };

    const refreshPresence = async () => {
      const db = supabase as typeof supabase & {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => {
              order: (column: string, options: { ascending: boolean }) => Promise<{ data: PresenceRow[] | null }>;
            };
          };
        };
      };

      const { data } = await db
        .from(TABLE)
        .select('display_name,is_camera_on,is_mic_on,joined_at,meeting_code,session_id')
        .eq('meeting_code', meetingId)
        .order('joined_at', { ascending: true });

      if (!active || !data) return;

      const remoteIds = data.map((row) => row.session_id).filter((id) => id !== localSessionId);
      const previousRemoteIds = previousRemoteIdsRef.current;
      const newParticipant = data.find(
        (row) => row.session_id !== localSessionId && !previousRemoteIds.includes(row.session_id),
      );

      useMeetingStore.setState({ participants: mapParticipants(data, localSessionId) });
      previousRemoteIdsRef.current = remoteIds;

      logWebRTCEvent('presence', 'refresh', {
        total: data.length,
        remote: remoteIds.length,
        sessions: remoteIds,
      });

      if (newParticipant) {
        logWebRTCEvent('presence', 'peer-joined', { session: newParticipant.session_id, name: newParticipant.display_name });
        playParticipantTone();
        toast.success(`${newParticipant.display_name} joined the meeting`);
      }
    };

    const bootstrap = async () => {
      const { data: authData } = await supabase.auth.getSession();
      const session = authData.session;
      if (!session || !active) return;

      const displayName = userName || session.user.email?.split('@')[0] || 'You';
      const { isMicOn: currentMicState, isCameraOn: currentCameraState } = useMeetingStore.getState();

      const db = supabase as typeof supabase & {
        from: (table: string) => {
          delete: () => { eq: (column: string, value: string) => Promise<unknown> };
          insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
        };
      };

      await db.from(TABLE).delete().eq('session_id', localSessionId);

      const { error } = await db.from(TABLE).insert({
        meeting_code: meetingId,
        user_id: session.user.id,
        session_id: localSessionId,
        display_name: displayName,
        is_mic_on: currentMicState,
        is_camera_on: currentCameraState,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      await refreshPresence();

      channel = supabase
        .channel(`meeting-presence-${meetingId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: TABLE, filter: `meeting_code=eq.${meetingId}` },
          () => {
            void refreshPresence();
          },
        )
        .subscribe();
    };

    void bootstrap();

    return () => {
      active = false;
      previousRemoteIdsRef.current = [];
      if (channel) supabase.removeChannel(channel);
      const db = supabase as typeof supabase & {
        from: (table: string) => { delete: () => { eq: (column: string, value: string) => Promise<unknown> } };
      };
      void db.from(TABLE).delete().eq('session_id', localSessionId);
    };
  }, [localSessionId, meetingId, screen, userName]);

  useEffect(() => {
    if (screen !== 'meeting' || !meetingId) return;

    const current = useMeetingStore.getState().participants;
    useMeetingStore.setState({
      participants: current.map((participant) =>
        participant.id === '1'
          ? { ...participant, isMuted: !isMicOn, isCameraOn }
          : participant,
      ),
    });

    const db = supabase as typeof supabase & {
      from: (table: string) => { update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<unknown> } };
    };
    void db.from(TABLE).update({ is_mic_on: isMicOn, is_camera_on: isCameraOn }).eq('session_id', localSessionId);
  }, [isCameraOn, isMicOn, localSessionId, meetingId, screen]);

  return null;
}
