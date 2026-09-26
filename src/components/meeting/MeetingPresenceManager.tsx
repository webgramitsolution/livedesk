import { useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore, type Participant } from '@/store/meetingStore';
import { toast } from 'sonner';
import { logWebRTCEvent } from '@/lib/webrtcLogger';
import { permissionFromRow, type ParticipantPermission, type PermissionRow } from '@/lib/permissions';
import { claimMeetingHost, type MeetingRow } from '@/lib/permissions/api';
import { isLocalSignalingEnabled } from '@/lib/signaling';

type PresenceRow = {
  id?: string;
  user_id: string;
  display_name: string;
  is_camera_on: boolean;
  is_mic_on: boolean;
  joined_at: string;
  meeting_code: string;
  session_id: string;
};

const TABLE = 'meeting_presence';
const PERMISSIONS_TABLE = 'meeting_participant_permissions';
const MEETINGS_TABLE = 'meetings';

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

// Loosely typed table access: the generated Database type is extended by the
// new migration, but presence/permissions queries are kept explicit here so a
// stale generated file cannot break the build.
type LooseDb = {
  from: (table: string) => {
    select: (columns: string, options?: { head?: boolean; count?: 'exact' }) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ data: unknown[] | null; count: number | null; error: { message: string } | null }>;
        order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        maybeSingle: () => Promise<{ data: unknown | null; error: { message: string } | null }>;
      } & Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      } & Promise<{ error: { message: string } | null }>;
    };
    insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    delete: () => { eq: (column: string, value: string) => Promise<unknown> };
  };
};

const db = () => supabase as unknown as LooseDb;

/**
 * MeetingPresenceManager owns the server-backed session state:
 * - presence rows (who is in the meeting)
 * - host claim + meeting row (status, global controls)
 * - per-participant permission rows
 * - local enforcement of permissions (forced mute / camera off / share stop)
 * - reacting to removal by the host or the meeting ending
 */
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
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null;
    let sessionChannel: ReturnType<typeof supabase.channel> | null = null;
    let hadPresenceRow = false;

    const mapParticipants = (rows: PresenceRow[], localSessionId: string) => {
      const current = useMeetingStore.getState().participants;
      const currentById = new Map(current.map((participant) => [participant.id, participant]));

      return rows
        .map((row): Participant => {
          const id = row.session_id === localSessionId ? '1' : row.session_id;
          const previous = currentById.get(id);
          return {
            id,
            sessionId: row.session_id,
            userId: row.user_id ?? null,
            name: row.display_name,
            isMuted: !row.is_mic_on,
            isCameraOn: row.is_camera_on,
            isSpeaking: previous?.isSpeaking ?? false,
            handRaised: previous?.handRaised ?? false,
            handRaisedAt: previous?.handRaisedAt ?? null,
            avatar: getInitials(row.display_name),
            spokenLanguage: previous?.spokenLanguage ?? 'en',
          };
        })
        .sort((a, b) => (a.id === '1' ? -1 : b.id === '1' ? 1 : 0));
    };

    const refreshPresence = async () => {
      const { data } = await db()
        .from(TABLE)
        .select('user_id,display_name,is_camera_on,is_mic_on,joined_at,meeting_code,session_id')
        .eq('meeting_code', meetingId)
        .order('joined_at', { ascending: true });

      if (!active || !data) return;
      const rows = data as PresenceRow[];

      const remoteIds = rows.map((row) => row.session_id).filter((id) => id !== localSessionId);
      const previousRemoteIds = previousRemoteIdsRef.current;
      const newParticipant = rows.find(
        (row) => row.session_id !== localSessionId && !previousRemoteIds.includes(row.session_id),
      );

      const hasOwnRow = rows.some((row) => row.session_id === localSessionId);
      if (hadPresenceRow && !hasOwnRow) {
        // Our row disappeared and we did not leave: the host removed us.
        const state = useMeetingStore.getState();
        if (state.session.meetingStatus !== 'ended') {
          state.setSession({ leaveReason: 'You were removed from the meeting by the host.' });
          toast.error('You were removed from the meeting by the host.');
          state.leaveMeeting();
        }
        return;
      }
      hadPresenceRow = hadPresenceRow || hasOwnRow;

      useMeetingStore.setState({ participants: mapParticipants(rows, localSessionId) });
      previousRemoteIdsRef.current = remoteIds;

      logWebRTCEvent('presence', 'refresh', {
        total: rows.length,
        remote: remoteIds.length,
        sessions: remoteIds,
      });

      if (newParticipant) {
        logWebRTCEvent('presence', 'peer-joined', { session: newParticipant.session_id, name: newParticipant.display_name });
        playParticipantTone();
        toast.success(`${newParticipant.display_name} joined the meeting`);
      }
    };

    const applyMeetingRow = (row: MeetingRow | null) => {
      if (!row) return;
      const state = useMeetingStore.getState();
      state.setSession({
        hostUserId: row.host_user_id,
        hostSessionId: row.host_session_id,
        meetingStatus: row.status,
        meetingControls: {
          annotationEnabled: !!row.annotation_enabled,
          remoteControlEnabled: !!row.remote_control_enabled,
        },
      });
      if (row.status === 'ended' && state.screen === 'meeting') {
        state.setSession({ leaveReason: 'The host ended the meeting.' });
        toast.info('The host ended the meeting.');
        state.leaveMeeting();
      }
    };

    const refreshPermissions = async () => {
      const { data } = await db()
        .from(PERMISSIONS_TABLE)
        .select('meeting_code,session_id,user_id,can_speak,can_use_camera,can_share_screen,can_annotate,can_request_remote_control,remote_control_granted')
        .eq('meeting_code', meetingId)
        .order('updated_at', { ascending: true });
      if (!active || !data) return;
      const rows: Record<string, ParticipantPermission> = {};
      (data as PermissionRow[]).forEach((row) => {
        rows[row.session_id] = permissionFromRow(row);
      });
      useMeetingStore.getState().setPermissionRows(rows);
    };

    const refreshMeeting = async () => {
      const { data } = await db()
        .from(MEETINGS_TABLE)
        .select('meeting_code,host_user_id,host_session_id,status,annotation_enabled,remote_control_enabled,created_at,ended_at')
        .eq('meeting_code', meetingId)
        .maybeSingle();
      if (!active) return;
      applyMeetingRow((data as MeetingRow | null) ?? null);
    };

    const bootstrap = async () => {
      if (isLocalSignalingEnabled()) {
        // Local test mode without a backend: no auth or presence rows. The tab
        // tagged as host (or the first tab) acts as host; others are members.
        const role = window.sessionStorage.getItem('livedesk-e2e-role') ?? 'host';
        const hostSession = window.sessionStorage.getItem('livedesk-e2e-host-session') ?? localSessionId;
        useMeetingStore.getState().setSession({
          myUserId: role === 'host' ? 'local-host' : `local-${localSessionId}`,
          hostUserId: 'local-host',
          hostSessionId: hostSession,
          meetingStatus: 'active',
          hasBackend: false,
        });
        return;
      }
      const { data: authData } = await supabase.auth.getSession();
      const session = authData.session;
      if (!session || !active) return;

      const displayName = userName || session.user.email?.split('@')[0] || 'You';
      const { isMicOn: currentMicState, isCameraOn: currentCameraState } = useMeetingStore.getState();
      useMeetingStore.getState().setSession({ myUserId: session.user.id, hasBackend: true });

      const presenceValues = {
        meeting_code: meetingId,
        user_id: session.user.id,
        session_id: localSessionId,
        display_name: displayName,
        is_mic_on: currentMicState,
        is_camera_on: currentCameraState,
      };

      const { data: existingRows } = await db()
        .from(TABLE)
        .select('id')
        .eq('meeting_code', meetingId)
        .eq('session_id', localSessionId);

      const { error } = existingRows?.length
        ? await db()
            .from(TABLE)
            .update(presenceValues)
            .eq('meeting_code', meetingId)
            .eq('session_id', localSessionId)
        : await db().from(TABLE).insert(presenceValues);

      if (error) {
        toast.error('Could not join the meeting session. Please try again.');
        logWebRTCEvent('error', 'presence-write-failed', { reason: error.message });
        return;
      }
      hadPresenceRow = true;

      // Claim host (creator) or read the existing meeting row.
      try {
        const row = await claimMeetingHost(meetingId, localSessionId);
        if (!active) return;
        applyMeetingRow(row);
      } catch (err) {
        logWebRTCEvent('error', 'claim-host-failed', { reason: String(err) });
      }

      await Promise.all([refreshPresence(), refreshPermissions()]);

      presenceChannel = supabase
        .channel(`meeting-presence-${meetingId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: TABLE, filter: `meeting_code=eq.${meetingId}` },
          () => {
            void refreshPresence();
          },
        )
        .subscribe();

      sessionChannel = supabase
        .channel(`meeting-session-${meetingId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: PERMISSIONS_TABLE, filter: `meeting_code=eq.${meetingId}` },
          () => {
            void refreshPermissions();
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: MEETINGS_TABLE, filter: `meeting_code=eq.${meetingId}` },
          (payload) => {
            if (payload.eventType === 'DELETE') {
              const state = useMeetingStore.getState();
              if (state.screen === 'meeting') {
                state.setSession({ leaveReason: 'The meeting has ended.' });
                state.leaveMeeting();
              }
              return;
            }
            applyMeetingRow(payload.new as MeetingRow);
          },
        )
        .subscribe();
    };

    void bootstrap();

    return () => {
      active = false;
      previousRemoteIdsRef.current = [];
      if (presenceChannel) supabase.removeChannel(presenceChannel);
      if (sessionChannel) supabase.removeChannel(sessionChannel);
      if (!isLocalSignalingEnabled()) void db().from(TABLE).delete().eq('session_id', localSessionId);
    };
  }, [localSessionId, meetingId, screen, userName]);

  // Mirror local mic/camera state into the presence row.
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

    if (!isLocalSignalingEnabled()) void db().from(TABLE).update({ is_mic_on: isMicOn, is_camera_on: isCameraOn }).eq('session_id', localSessionId);
  }, [isCameraOn, isMicOn, localSessionId, meetingId, screen]);

  // Local enforcement: when the host removes a capability, apply it to the
  // real media state immediately. The UI reads the same permission to disable
  // the corresponding buttons; useWebRTC disables the track.
  const permissionRows = useMeetingStore((s) => s.session.permissionRows);
  const meetingControls = useMeetingStore((s) => s.session.meetingControls);
  const hostUserId = useMeetingStore((s) => s.session.hostUserId);
  const myUserId = useMeetingStore((s) => s.session.myUserId);
  useEffect(() => {
    if (screen !== 'meeting') return;
    const state = useMeetingStore.getState();
    const perm = state.myPermission();
    if (!perm.canSpeak && state.isMicOn) {
      state.setMicOn(false);
      toast.info('The host muted your microphone.');
    }
    if (!perm.canUseCamera && state.isCameraOn) {
      state.setCameraOn(false);
      toast.info('The host turned off your camera.');
    }
    if (!perm.canShareScreen && state.isScreenSharing) {
      state.toggleScreenShare();
      toast.info('The host stopped your screen share.');
    }
  }, [permissionRows, meetingControls, hostUserId, myUserId, screen]);

  return null;
}
