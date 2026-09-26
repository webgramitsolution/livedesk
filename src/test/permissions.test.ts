import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEETING_CONTROLS,
  DEFAULT_PARTICIPANT_PERMISSION,
  permissionFromRow,
  permissionPatchToRow,
  resolvePermission,
} from '@/lib/permissions';

describe('permission model', () => {
  it('members default to no annotation and no remote control, but may speak, use camera and share', () => {
    const p = resolvePermission('s1', false, {}, DEFAULT_MEETING_CONTROLS);
    expect(p).toEqual(DEFAULT_PARTICIPANT_PERMISSION);
    expect(p.canAnnotate).toBe(false);
    expect(p.remoteControlGranted).toBe(false);
  });

  it('host always has full rights and can never be a remote controller', () => {
    const p = resolvePermission('host', true, { host: { ...DEFAULT_PARTICIPANT_PERMISSION, canSpeak: false } }, DEFAULT_MEETING_CONTROLS);
    expect(p.canSpeak).toBe(true);
    expect(p.canAnnotate).toBe(true);
    expect(p.canRequestRemoteControl).toBe(false);
  });

  it('global controls restrict but never widen individual permissions', () => {
    const rows = { m1: { ...DEFAULT_PARTICIPANT_PERMISSION, canAnnotate: true, remoteControlGranted: true } };
    const restricted = resolvePermission('m1', false, rows, { annotationEnabled: false, remoteControlEnabled: false });
    expect(restricted.canAnnotate).toBe(false);
    expect(restricted.canRequestRemoteControl).toBe(false);
    expect(restricted.remoteControlGranted).toBe(false);
    const open = resolvePermission('m2', false, {}, { annotationEnabled: true, remoteControlEnabled: true });
    expect(open.canAnnotate).toBe(false);
  });

  it('annotation and remote control are independent permissions', () => {
    const rows = {
      a: { ...DEFAULT_PARTICIPANT_PERMISSION, canAnnotate: true, remoteControlGranted: false },
      b: { ...DEFAULT_PARTICIPANT_PERMISSION, canAnnotate: false, remoteControlGranted: true },
    };
    const a = resolvePermission('a', false, rows, DEFAULT_MEETING_CONTROLS);
    const b = resolvePermission('b', false, rows, DEFAULT_MEETING_CONTROLS);
    expect(a.canAnnotate && !a.remoteControlGranted).toBe(true);
    expect(!b.canAnnotate && b.remoteControlGranted).toBe(true);
  });

  it('maps rows and patches between snake_case and camelCase', () => {
    expect(
      permissionFromRow({
        meeting_code: 'x', session_id: 's', user_id: null,
        can_speak: false, can_use_camera: true, can_share_screen: false,
        can_annotate: true, can_request_remote_control: false, remote_control_granted: true,
      }),
    ).toEqual({ canSpeak: false, canUseCamera: true, canShareScreen: false, canAnnotate: true, canRequestRemoteControl: false, remoteControlGranted: true });
    expect(permissionPatchToRow({ canSpeak: false, canAnnotate: true })).toEqual({ can_speak: false, can_annotate: true });
    // remoteControlGranted is never client-settable through a patch.
    expect(permissionPatchToRow({ remoteControlGranted: true })).toEqual({});
  });
});
