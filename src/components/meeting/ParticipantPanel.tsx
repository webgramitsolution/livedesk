import { useMemo, useState } from 'react';
import {
  Crown,
  Hand,
  Mic,
  MicOff,
  Monitor,
  MonitorCog,
  MousePointerClick,
  PenLine,
  PhoneOff,
  Shield,
  UserX,
  Users,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useMeetingStore, type Participant } from '@/store/meetingStore';
import { usePanelOverlayMode } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { ParticipantPermission } from '@/lib/permissions';
import {
  endMeeting,
  removeParticipant,
  revokeRemoteControl,
  setAllParticipantPermissions,
  setMeetingControls,
  setParticipantPermission,
} from '@/lib/permissions/api';

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/only the host/i.test(message)) return 'Only the host can do that.';
  if (/not active/i.test(message)) return 'This meeting is no longer active.';
  return 'The action could not be applied. Please try again.';
}

function StatusIcon({ on, OnIcon, OffIcon, label }: { on: boolean; OnIcon: typeof Mic; OffIcon: typeof MicOff; label: string }) {
  const Icon = on ? OnIcon : OffIcon;
  return <Icon className={cn('h-3 w-3', on ? 'text-success' : 'text-muted-foreground')} aria-label={label} />;
}

function ActionButton({
  label,
  onClick,
  Icon,
  tone = 'default',
  busy = false,
}: {
  label: string;
  onClick: () => void;
  Icon: typeof Mic;
  tone?: 'default' | 'danger' | 'primary';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        tone === 'danger'
          ? 'text-destructive hover:bg-destructive/10'
          : tone === 'primary'
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

interface RowProps {
  participant: Participant;
  permission: ParticipantPermission;
  isSelf: boolean;
  isHostRow: boolean;
  viewerIsHost: boolean;
  isPresenting: boolean;
  connection: string;
  onAction: (action: () => Promise<unknown>, success?: string) => void;
  busy: boolean;
  meetingId: string;
}

function ParticipantRow({ participant: p, permission, isSelf, isHostRow, viewerIsHost, isPresenting, connection, onAction, busy, meetingId }: RowProps) {
  const [showControls, setShowControls] = useState(false);
  const sessionId = p.sessionId;
  const connected = isSelf || connection === 'connected';
  const canAdmin = viewerIsHost && !isSelf && !isHostRow;

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn('rounded-xl border transition-colors', permission.remoteControlGranted ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted/50')}
      data-testid={`participant-row-${sessionId || 'local'}`}
    >
      <div className="flex items-center gap-3 p-2.5">
        <div className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted', p.isSpeaking && 'ring-2 ring-success')}>
          <span className="text-xs font-display font-bold text-muted-foreground">{p.avatar}</span>
          {p.handRaised && <span className="absolute -right-1 -top-1 text-sm">✋</span>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
            {isSelf && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">YOU</span>}
            {isHostRow && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700" title="Host">
                <Crown className="h-2.5 w-2.5" /> HOST
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <StatusIcon on={!p.isMuted && permission.canSpeak} OnIcon={Mic} OffIcon={MicOff} label={p.isMuted ? 'Microphone off' : 'Microphone on'} />
            <StatusIcon on={p.isCameraOn && permission.canUseCamera} OnIcon={Video} OffIcon={VideoOff} label={p.isCameraOn ? 'Camera on' : 'Camera off'} />
            {isPresenting && <Monitor className="h-3 w-3 text-primary" aria-label="Sharing screen" />}
            {permission.canAnnotate && <PenLine className="h-3 w-3 text-primary" aria-label="Can annotate" />}
            {permission.remoteControlGranted && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-primary" aria-label="Has remote control">
                <MousePointerClick className="h-3 w-3" /> CTRL
              </span>
            )}
            {!isSelf && (
              connected ? (
                <Wifi className="h-3 w-3 text-success" aria-label="Connected" />
              ) : (
                <WifiOff className="h-3 w-3 text-amber-500" aria-label={connection === 'connecting' ? 'Connecting' : 'Reconnecting'} />
              )
            )}
            {!permission.canSpeak && !isHostRow && <span className="text-[9px] text-muted-foreground">muted by host</span>}
          </div>
        </div>

        {canAdmin && (
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label={showControls ? 'Hide controls' : 'Show controls'}
            aria-expanded={showControls}
            data-testid={`participant-controls-toggle-${sessionId}`}
          >
            {showControls ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {canAdmin && showControls && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/60 px-2.5 py-2" data-testid={`participant-controls-${sessionId}`}>
          {permission.canSpeak ? (
            <ActionButton label="Mute microphone" Icon={MicOff} busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canSpeak: false }), `${p.name} muted`)} />
          ) : (
            <ActionButton label="Allow microphone" Icon={Mic} tone="primary" busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canSpeak: true }), `${p.name} can speak`)} />
          )}
          {permission.canUseCamera ? (
            <ActionButton label="Disable camera" Icon={VideoOff} busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canUseCamera: false }), `${p.name}'s camera disabled`)} />
          ) : (
            <ActionButton label="Allow camera" Icon={Video} tone="primary" busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canUseCamera: true }), `${p.name} can use camera`)} />
          )}
          {permission.canShareScreen ? (
            <ActionButton label="Disallow screen sharing" Icon={Monitor} busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canShareScreen: false }), `${p.name} cannot share`)} />
          ) : (
            <ActionButton label="Allow screen sharing" Icon={Monitor} tone="primary" busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canShareScreen: true }), `${p.name} can share`)} />
          )}
          {permission.canAnnotate ? (
            <ActionButton label="Revoke annotation" Icon={PenLine} busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canAnnotate: false }), `${p.name} can no longer annotate`)} />
          ) : (
            <ActionButton label="Allow annotation" Icon={PenLine} tone="primary" busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canAnnotate: true }), `${p.name} can annotate`)} />
          )}
          {permission.remoteControlGranted ? (
            <ActionButton label="Stop remote control" Icon={MonitorCog} tone="danger" busy={busy} onClick={() => onAction(() => revokeRemoteControl(meetingId, sessionId, 'Host stopped remote control'), `Remote control stopped for ${p.name}`)} />
          ) : permission.canRequestRemoteControl ? (
            <ActionButton label="Revoke remote control" Icon={MonitorCog} busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canRequestRemoteControl: false }), `${p.name} cannot request control`)} />
          ) : (
            <ActionButton label="Allow remote control requests" Icon={MonitorCog} tone="primary" busy={busy} onClick={() => onAction(() => setParticipantPermission(meetingId, sessionId, { canRequestRemoteControl: true }), `${p.name} can request control`)} />
          )}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <ActionButton label="Remove from meeting" Icon={UserX} tone="danger" busy={busy} onClick={() => onAction(() => removeParticipant(meetingId, sessionId), `${p.name} removed`)} />
        </div>
      )}
    </motion.div>
  );
}

export function ParticipantPanel() {
  const rightPanel = useMeetingStore((s) => s.rightPanel);
  const toggleRightPanel = useMeetingStore((s) => s.toggleRightPanel);
  const participants = useMeetingStore((s) => s.participants);
  const toggleHandRaise = useMeetingStore((s) => s.toggleHandRaise);
  const meetingId = useMeetingStore((s) => s.meetingId);
  const meetingSessionId = useMeetingStore((s) => s.meetingSessionId);
  const isScreenSharing = useMeetingStore((s) => s.isScreenSharing);
  const session = useMeetingStore((s) => s.session);
  const rcSession = session.remoteControlSession;
  const [busy, setBusy] = useState(false);
  const [showGlobal, setShowGlobal] = useState(false);

  const isOpen = rightPanel === 'participants';
  const mode = usePanelOverlayMode();
  const isOverlay = mode !== 'desktop';
  const isMobile = mode === 'mobile';
  const viewerIsHost = !!session.myUserId && session.myUserId === session.hostUserId;

  const permissionFor = useMeetingStore.getState().permissionFor;
  const rows = useMemo(
    () =>
      participants.map((p) => {
        const sessionId = p.id === '1' ? meetingSessionId : p.sessionId;
        const isHostRow = !!p.userId && p.userId === session.hostUserId;
        return {
          participant: p,
          sessionId,
          isHostRow,
          permission: permissionFor(sessionId),
          isPresenting: p.id === '1' ? isScreenSharing : session.presenterId === p.sessionId,
          connection: session.peerConnectionStates[p.sessionId] ?? 'connecting',
        };
      }),
    // permissionFor reads session.permissionRows/meetingControls: included via `session`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, meetingSessionId, session, isScreenSharing],
  );

  const raisedHands = participants
    .filter((p) => p.handRaised)
    .sort((a, b) => (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0));

  const run = (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    action()
      .then(() => {
        if (success) toast.success(success);
      })
      .catch((err) => toast.error(friendlyError(err)))
      .finally(() => setBusy(false));
  };

  const controls = session.meetingControls;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {isOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-sm"
              onClick={() => toggleRightPanel('participants')}
            />
          )}
          <motion.aside
            initial={isMobile ? { y: '100%', opacity: 0.6 } : mode === 'tablet' ? { x: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            animate={isMobile ? { y: 0, opacity: 1 } : mode === 'tablet' ? { x: 0, opacity: 1 } : { width: 340, opacity: 1 }}
            exit={isMobile ? { y: '100%', opacity: 0.6 } : mode === 'tablet' ? { x: '100%', opacity: 0.6 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className={`${
              isMobile
                ? 'fixed inset-0 z-[60] rounded-none border-0'
                : mode === 'tablet'
                  ? 'fixed inset-y-0 right-0 w-[90vw] max-w-[420px] z-[60] border-l shadow-2xl'
                  : 'h-full shrink-0 border-l'
            } bg-background flex flex-col overflow-hidden`}
            style={mode === 'desktop' ? { width: 340 } : undefined}
            data-testid="participant-panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="font-display text-lg font-bold text-foreground">Participants</h2>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{participants.length}</span>
              </div>
              <button
                onClick={() => toggleRightPanel('participants')}
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted sm:h-9 sm:w-9"
                aria-label="Close participants"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Active remote-control banner (host or presenter sees STOP) */}
            {rcSession && (
              <div className="mx-4 mt-3 rounded-lg border border-primary/20 bg-primary/10 p-3" data-testid="rc-active-banner">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MousePointerClick className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-primary">Remote control active: {rcSession.controllerName}</p>
                      <p className="text-[10px] text-muted-foreground">{rcSession.mode === 'mouse+keyboard' ? 'Mouse and keyboard' : 'Mouse only'} · Esc to stop</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => run(() => revokeRemoteControl(meetingId, rcSession.controllerId, 'Host stopped remote control'), 'Remote control stopped')}
                    className="shrink-0 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
                    data-testid="rc-stop-button"
                  >
                    STOP CONTROL
                  </button>
                </div>
              </div>
            )}

            {/* Raised hands queue */}
            {raisedHands.length > 0 && (
              <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Hand className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-bold text-amber-700">Raised hands ({raisedHands.length})</span>
                </div>
                <div className="space-y-1.5">
                  {raisedHands.map((p, i) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-4 font-mono text-[10px] text-amber-500">{i + 1}.</span>
                        <span className="text-xs font-medium text-amber-800">{p.name}</span>
                      </div>
                      {(p.id === '1' || viewerIsHost) && (
                        <button onClick={() => toggleHandRaise(p.id)} className="rounded-full px-2 py-1 text-[10px] text-amber-600 hover:bg-amber-100">
                          Lower
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Host: global controls */}
            {viewerIsHost && (
              <div className="mx-4 mt-3 rounded-lg border border-border bg-muted/30" data-testid="host-controls">
                <button
                  type="button"
                  onClick={() => setShowGlobal((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold text-foreground"
                  aria-expanded={showGlobal}
                >
                  <span className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-primary" /> Host controls
                  </span>
                  {showGlobal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {showGlobal && (
                  <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canSpeak: false }), 'Everyone muted')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50" data-testid="host-mute-all">
                      Mute everyone
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canSpeak: true }), 'Everyone can speak')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                      Allow all mics
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canUseCamera: false }), 'All cameras disabled')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                      Disable all cameras
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canUseCamera: true }), 'Cameras allowed')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                      Allow cameras
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canAnnotate: true }), 'Annotation enabled for everyone')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                      Allow annotation (all)
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setAllParticipantPermissions(meetingId, { canAnnotate: false }), 'Annotation disabled for everyone')} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                      Revoke annotation (all)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => setMeetingControls(meetingId, { annotationEnabled: !controls.annotationEnabled }), controls.annotationEnabled ? 'Annotation switched off' : 'Annotation switched on')}
                      className={cn('rounded-lg border px-2 py-1.5 text-[11px] font-medium disabled:opacity-50', controls.annotationEnabled ? 'border-border bg-background hover:bg-muted' : 'border-destructive/40 bg-destructive/10 text-destructive')}
                    >
                      {controls.annotationEnabled ? 'Annotation: on' : 'Annotation: off'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => setMeetingControls(meetingId, { remoteControlEnabled: !controls.remoteControlEnabled }), controls.remoteControlEnabled ? 'Remote control disabled' : 'Remote control requests enabled')}
                      className={cn('rounded-lg border px-2 py-1.5 text-[11px] font-medium disabled:opacity-50', controls.remoteControlEnabled ? 'border-border bg-background hover:bg-muted' : 'border-destructive/40 bg-destructive/10 text-destructive')}
                      data-testid="host-toggle-remote-control"
                    >
                      {controls.remoteControlEnabled ? 'Remote control: on' : 'Remote control: off'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('End the meeting for everyone? All temporary session data is cleared.')) {
                          run(() => endMeeting(meetingId), 'Meeting ended');
                        }
                      }}
                      className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-destructive px-2 py-2 text-[11px] font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                      data-testid="host-end-meeting"
                    >
                      <PhoneOff className="h-3.5 w-3.5" /> End meeting for everyone
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Participant list */}
            <div className={`flex-1 space-y-1.5 overflow-y-auto p-4 ${isMobile ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : ''}`}>
              {rows.map((row) => (
                <ParticipantRow
                  key={row.participant.id}
                  participant={{ ...row.participant, sessionId: row.sessionId }}
                  permission={row.permission}
                  isSelf={row.participant.id === '1'}
                  isHostRow={row.isHostRow}
                  viewerIsHost={viewerIsHost}
                  isPresenting={row.isPresenting}
                  connection={row.connection}
                  onAction={run}
                  busy={busy}
                  meetingId={meetingId}
                />
              ))}
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Shield className="h-3.5 w-3.5 text-success" />
                <span>Permissions are enforced by the server. Annotation never grants remote control.</span>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
