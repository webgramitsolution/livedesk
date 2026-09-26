import { supabase } from '@/integrations/supabase/client';
import { permissionPatchToRow, type ParticipantPermission, type MeetingControls } from './index';

// Thin wrappers over the host-only RPCs. Every call is authorised server-side;
// these helpers only shape the arguments and surface errors.

export interface MeetingRow {
  meeting_code: string;
  host_user_id: string;
  host_session_id: string | null;
  status: 'active' | 'ended';
  annotation_enabled: boolean;
  remote_control_enabled: boolean;
  created_at: string;
  ended_at: string | null;
}

export interface RemoteControlSessionRow {
  id: string;
  meeting_code: string;
  presenter_session_id: string;
  presenter_user_id: string;
  controller_session_id: string;
  controller_user_id: string | null;
  token: string;
  mode: 'mouse' | 'mouse+keyboard';
  status: 'active' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const rpc = () => supabase as unknown as RpcClient;

function unwrap<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function claimMeetingHost(meetingCode: string, sessionId: string): Promise<MeetingRow> {
  return unwrap<MeetingRow>(await rpc().rpc('claim_meeting_host', { _meeting_code: meetingCode, _session_id: sessionId }));
}

export async function setParticipantPermission(meetingCode: string, sessionId: string, patch: Partial<ParticipantPermission>) {
  return unwrap<unknown>(
    await rpc().rpc('set_participant_permission', {
      _meeting_code: meetingCode,
      _session_id: sessionId,
      _patch: permissionPatchToRow(patch),
    }),
  );
}

export async function setAllParticipantPermissions(meetingCode: string, patch: Partial<ParticipantPermission>) {
  return unwrap<number>(
    await rpc().rpc('set_all_participant_permissions', {
      _meeting_code: meetingCode,
      _patch: permissionPatchToRow(patch),
    }),
  );
}

export async function setMeetingControls(meetingCode: string, patch: Partial<MeetingControls>) {
  const row: Record<string, boolean> = {};
  if (patch.annotationEnabled !== undefined) row.annotation_enabled = patch.annotationEnabled;
  if (patch.remoteControlEnabled !== undefined) row.remote_control_enabled = patch.remoteControlEnabled;
  return unwrap<MeetingRow>(await rpc().rpc('set_meeting_controls', { _meeting_code: meetingCode, _patch: row }));
}

export async function grantRemoteControl(
  meetingCode: string,
  presenterSessionId: string,
  controllerSessionId: string,
  mode: 'mouse' | 'mouse+keyboard',
): Promise<RemoteControlSessionRow> {
  return unwrap<RemoteControlSessionRow>(
    await rpc().rpc('grant_remote_control', {
      _meeting_code: meetingCode,
      _presenter_session_id: presenterSessionId,
      _controller_session_id: controllerSessionId,
      _mode: mode,
    }),
  );
}

export async function revokeRemoteControl(meetingCode: string, controllerSessionId: string, reason?: string) {
  return unwrap<number>(
    await rpc().rpc('revoke_remote_control', {
      _meeting_code: meetingCode,
      _controller_session_id: controllerSessionId,
      _reason: reason ?? null,
    }),
  );
}

export async function verifyRemoteControlToken(meetingCode: string, token: string): Promise<RemoteControlSessionRow | null> {
  const row = unwrap<RemoteControlSessionRow | null>(
    await rpc().rpc('verify_remote_control_token', { _meeting_code: meetingCode, _token: token }),
  );
  return row && row.token ? row : null;
}

export async function removeParticipant(meetingCode: string, sessionId: string) {
  return unwrap<boolean>(await rpc().rpc('remove_participant', { _meeting_code: meetingCode, _session_id: sessionId }));
}

export async function endMeeting(meetingCode: string) {
  return unwrap<boolean>(await rpc().rpc('end_meeting', { _meeting_code: meetingCode }));
}
