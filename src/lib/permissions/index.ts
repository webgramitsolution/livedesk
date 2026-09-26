// Participant permission model. The source of truth is the
// meeting_participant_permissions table (written only by the host through
// SECURITY DEFINER RPCs). Clients never trust a peer message for permissions;
// they read rows and enforce them locally (sender side and receiver side).

export interface ParticipantPermission {
  canSpeak: boolean;
  canUseCamera: boolean;
  canShareScreen: boolean;
  canAnnotate: boolean;
  canRequestRemoteControl: boolean;
  remoteControlGranted: boolean;
}

export interface MeetingControls {
  annotationEnabled: boolean;
  remoteControlEnabled: boolean;
}

export interface PermissionRow {
  meeting_code: string;
  session_id: string;
  user_id: string | null;
  can_speak: boolean;
  can_use_camera: boolean;
  can_share_screen: boolean;
  can_annotate: boolean;
  can_request_remote_control: boolean;
  remote_control_granted: boolean;
  updated_at?: string;
}

export const DEFAULT_PARTICIPANT_PERMISSION: ParticipantPermission = {
  canSpeak: true,
  canUseCamera: true,
  canShareScreen: true,
  canAnnotate: false,
  canRequestRemoteControl: true,
  remoteControlGranted: false,
};

export const HOST_PERMISSION: ParticipantPermission = {
  canSpeak: true,
  canUseCamera: true,
  canShareScreen: true,
  canAnnotate: true,
  canRequestRemoteControl: true,
  remoteControlGranted: false,
};

export const DEFAULT_MEETING_CONTROLS: MeetingControls = {
  annotationEnabled: true,
  remoteControlEnabled: true,
};

export function permissionFromRow(row: PermissionRow): ParticipantPermission {
  return {
    canSpeak: !!row.can_speak,
    canUseCamera: !!row.can_use_camera,
    canShareScreen: !!row.can_share_screen,
    canAnnotate: !!row.can_annotate,
    canRequestRemoteControl: !!row.can_request_remote_control,
    remoteControlGranted: !!row.remote_control_granted,
  };
}

export function permissionPatchToRow(patch: Partial<ParticipantPermission>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (patch.canSpeak !== undefined) out.can_speak = patch.canSpeak;
  if (patch.canUseCamera !== undefined) out.can_use_camera = patch.canUseCamera;
  if (patch.canShareScreen !== undefined) out.can_share_screen = patch.canShareScreen;
  if (patch.canAnnotate !== undefined) out.can_annotate = patch.canAnnotate;
  if (patch.canRequestRemoteControl !== undefined) out.can_request_remote_control = patch.canRequestRemoteControl;
  return out;
}

/**
 * Resolve the effective permission for a session. The host always has full
 * rights; everyone else gets their row or the defaults. Global controls can
 * only restrict, never widen.
 */
export function resolvePermission(
  sessionId: string,
  isHostSession: boolean,
  rows: Record<string, ParticipantPermission>,
  controls: MeetingControls,
): ParticipantPermission {
  const base = isHostSession ? HOST_PERMISSION : rows[sessionId] ?? DEFAULT_PARTICIPANT_PERMISSION;
  return {
    ...base,
    canAnnotate: base.canAnnotate && (controls.annotationEnabled || isHostSession),
    canRequestRemoteControl: base.canRequestRemoteControl && controls.remoteControlEnabled && !isHostSession,
    remoteControlGranted: base.remoteControlGranted && controls.remoteControlEnabled,
  };
}
