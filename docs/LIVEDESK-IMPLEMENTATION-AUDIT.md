# LiveDesk Implementation Audit (Phase 0)

Date: 2026-09-26
Branch: `claude/bold-ptolemy-c2h4r6`
Baseline commit: `20ffaf9` (Add project README)

This document records the state of the repository before any feature work for the
hybrid meeting + remote support platform. Everything below was verified by reading
the code and running the toolchain in this session; nothing is assumed.

## 1. Baseline toolchain results

| Check | Command | Result |
|-------|---------|--------|
| Install | `npm ci` | FAILS: `package-lock.json` out of sync with `package.json` (`@lovable.dev/mcp-js`, `express`, `http-errors` missing from lock). `npm install` succeeds (731 packages). |
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | PASS (note: `strict: false`, `noImplicitAny: false`). |
| Build | `npx vite build` | PASS. Single 1.48 MB JS chunk (418 kB gzip), no code splitting. |
| Lint | `npx eslint .` | 23 errors, 25 warnings. Errors: `no-explicit-any` (LobbyScreen), `no-unused-expressions` (useWebRTC cleanup, e2e spec), `no-empty` (meetingStore), `no-var` (supabase/functions/mcp), `no-require-imports` (tailwind.config), `prefer-const` (previewAuthStorage). |
| Unit tests | `npx vitest run` | 32 pass, 1 FAIL: `security-regression.test.ts` asserts `useWebRTC.ts` contains `upsert`; the code uses select+insert/update instead (stale assertion, not a real regression). |
| Electron RC test | `npm run test:electron` | Not runnable here (needs xvfb + libX11). Harness exists in `scripts/electron-rc-integration.mjs`. |
| Playwright e2e | `e2e/*.spec.ts` | Two UI-only suites (mobile submenus, taskbar centering). They seed sessionStorage to bypass auth/WebRTC. No media test exists. |
| Runtime | `vite dev` on :8080 | Boots. Any meeting flow requires a Supabase session (redirects to `/auth`), so real meeting behaviour cannot be exercised without credentials. |

## 2. Current architecture

```
React 18 + Vite + TypeScript (non-strict) + Tailwind/shadcn + Zustand + framer-motion
        |
        +-- src/pages: Index (lobby/waiting/connecting/meeting switch), Auth, ResetPassword,
        |              MeetingHistory, OAuthConsent (Lovable), NotFound
        +-- src/store/meetingStore.ts  (single Zustand store; sessionStorage persistence)
        +-- src/hooks/useWebRTC.ts     (mesh RTCPeerConnection per peer; signaling via
        |                               Supabase Realtime broadcast channel `webrtc-<code>`)
        +-- src/hooks/useRemoteControl.ts (control state machine; messages ALSO ride on
        |                               the Supabase `webrtc-<code>` broadcast channel)
        +-- src/lib/remoteControl/*    (protocol, validation, executor, audit, persistence)
        +-- src/components/meeting/*   (MeetingRoom, VideoGrid, VideoTile, overlays, panels)
        +-- src/integrations/supabase  (client, generated types, Lovable preview auth broker)
        +-- supabase/migrations        (scheduled_meetings, meeting_presence, meeting_join_requests,
        |                               realtime.messages RLS)
        +-- supabase/functions         (translate-text, elevenlabs-scribe-token,
        |                               analyze-webrtc-diagnostics, mcp)
        +-- electron/                  (preload.cjs, remoteControlHandler.cjs, README)
                                        NOTE: there is NO electron main file and NO electron
                                        dependency; the desktop app cannot be built today.
```

Media plane and data plane are NOT separated: there is no `RTCDataChannel` anywhere.
Remote-control cursor/input, presenter announcements and lock state all go through the
Supabase Realtime broadcast (server round trip on every mouse move).

Signaling: `join` broadcast -> every existing peer sends an offer -> perfect-negotiation
style collision handling using lexical peer-id ordering (`isPolitePeer`). ICE: Google
STUN + public `openrelay.metered.ca` TURN with shared public credentials (hard-coded).

## 3. Existing feature inventory

### 3.1 Working (verified by code reading; runtime requires Supabase credentials)

| Area | Location | Notes |
|------|----------|-------|
| Auth (email/password, Google via Lovable, reset) | `src/pages/Auth.tsx` | Real Supabase auth. Raw Supabase error strings are shown to the user (spec violation). Branding says "Zoom Connect". |
| Meeting creation / join / invite links | `LobbyScreen.tsx`, `lib/meetingInvite.ts` | CSPRNG meeting codes. First joiner enters directly; later joiners create a `meeting_join_requests` row and wait (`WaitingRoomScreen`), any member can admit (`JoinRequestNotifier`). |
| Presence | `MeetingPresenceManager.tsx` | `meeting_presence` rows + postgres_changes. Participant list is derived from presence. |
| Device preflight | `ConnectingScreen.tsx`, `lib/mediaPreflight.ts` | Real getUserMedia, per-device failure reasons, stream handoff to the meeting. |
| Local media, mute/camera toggle, device selection, retries | `useWebRTC.ts` | Track `enabled` flag toggled; `replaceTrack` on device change; backoff retries; diagnostics. |
| Mesh audio/video between N peers | `useWebRTC.ts` | recvonly transceivers when local media missing; renegotiation retries; peer restart with backoff; browser online/visibility re-run. |
| Remote audio playback recovery | `VideoTile.tsx`, `lib/remoteAudioRecovery.ts` | Separate `<audio data-remote-audio>` per remote peer, autoplay-block recovery. |
| Screen share (start/stop, self-capture detection) | `useWebRTC.ts` startScreenShare | Uses `getDisplayMedia` with `selfBrowserSurface: 'exclude'`; capture-handle based self-capture detection; local preview suppressed when self-captured. |
| Remote control request/grant/deny/revoke/queue/lock/Esc | `useRemoteControl.ts`, `RemoteControlOverlay.tsx` | Solid state machine with nonce-bound input, signed+replay-protected envelope, audit log, metrics, unit tests (queue, replay, unauthorized). |
| Browser in-tab input dispatch | `lib/remoteControl/inputExecutor.ts` | Synthetic DOM events only (cannot drive the OS). |
| Electron nut-js handler | `electron/remoteControlHandler.cjs` | Mouse move/down/up/click/double/wheel/keydown/keyup with modifier key mapping. Real-dependency harness in `scripts/`. |
| Live cursors + click ripples | `RemoteControlOverlay.tsx` | Normalized 0..1 coordinates over the overlay container. |
| Local transcription (own mic) | `useLiveTranscription.ts` | ElevenLabs Scribe realtime via single-use token edge function. Text only. |
| Text translation | `supabase/functions/translate-text` | Lovable AI gateway (proprietary), auth-gated. |
| Recording (local, explicit) | `useMeetingRecorder.ts` | MediaRecorder, download on leave. Matches the "recording saved locally on explicit action" rule. |
| Mobile UI, submenus, PiP, keyboard shortcuts, virtual background, noise filter | various | UI-complete; noise filter is a biquad/compressor chain, not ML. |

### 3.2 Broken or incorrect

| # | Problem | Location |
|---|---------|----------|
| B1 | `npm ci` fails (lock out of sync). | `package-lock.json` |
| B2 | 1 failing unit test (stale `upsert` assertion). | `src/test/security-regression.test.ts` |
| B3 | 23 lint errors. | see section 1 |
| B4 | `.env` is committed to git (Supabase URL + publishable key + project id). Publishable keys are not secrets, but the file must not be tracked and there is no `.env.example`. | `.env`, `.gitignore` |
| B5 | Screen-share audio "feedback prevention" is dead code: it clones the track and discards the clone. | `useWebRTC.ts` ~L696 |
| B6 | Remote screen-track detection is heuristic (`videoReceiverCount > 1` or label regex). If a camera-less peer shares first, or a peer with camera off shares, the screen track can be routed to the camera tile. | `useWebRTC.ts` ontrack |
| B7 | Remote-control coordinates are normalized against the overlay container box, not the video content box. With `object-fit: contain` letterboxing, x/y are wrong on the presenter (aspect mismatch 16:9 vs 16:10, etc.). | `RemoteControlOverlay.tsx` toNorm |
| B8 | Remote-control "controlling" status and presenter `activeController` are silently restored from sessionStorage after reload (spec: never reconnect a control session silently). | `lib/remoteControl/persistence.ts`, `useRemoteControl.ts` |
| B9 | Whiteboard is local only, pixel-based (breaks across resolutions), pen/eraser only, no undo/redo/shapes, only the presenter can open it, and it is not synchronized to anyone. | `WhiteboardOverlay.tsx` |
| B10 | `ParticipantPanel` "Request"/"Grant"/"Revoke" buttons mutate local Zustand state only (`hasMouseControl`), disconnected from the real remote-control engine. This is mock functionality. | `ParticipantPanel.tsx`, `meetingStore.ts` |
| B11 | Chat, reactions and hand-raise are local only (never sent to other participants). | `meetingStore.ts sendChatMessage/sendReaction/toggleHandRaise` |
| B12 | Settings modal device lists are hard-coded fake devices ("USB Condenser Mic"), not `enumerateDevices()`. Selecting them sets an invalid deviceId. | `SettingsModal.tsx` |
| B13 | Fake data in UI: `TRANSLATED_SAMPLES`/`TRANSLATED_SUBTITLES` mock translations, "1.2s / 94%" static stats, random `AudioLevelBars`, `latency: 'good'` never measured, "E2E encrypted" badge with no E2E, `addSimulatedParticipant`, Whisper model selector with no Whisper. | `AISidebar.tsx`, `VideoGrid.tsx`, `VideoTile.tsx`, `NavigationBar.tsx`, `SettingsModal.tsx` |
| B14 | `isSpeaking` is never set from real audio. | store/tiles |
| B15 | Electron: no `main.cjs`, no `electron` dependency, no packaging config. `nut-js` is a devDependency. The preload bridge forwards any object to the main process; the main handler does not validate event shape, session, token, or participant. | `electron/` |
| B16 | Any authenticated meeting member can approve join requests (no host concept). | migrations (RLS on `meeting_join_requests`) |
| B17 | Message signature is FNV-1a over public fields (no secret); it only detects accidental corruption and cross-meeting replay, not forgery. Documented in code, but must not be presented as authentication. | `lib/remoteControl/protocol.ts` |
| B18 | Free public TURN credentials hard-coded. | `useWebRTC.ts` ICE_SERVERS |
| B19 | No Content-Security-Policy. | `index.html` |
| B20 | Branding inconsistent ("Zoom Connect", "ZC") versus product name LiveDesk and the approved landing/login design. | `NavigationBar`, `Auth`, `LobbyScreen` |

### 3.3 Missing (required by the target specification)

- Data plane: RTCDataChannel for annotation, control input, participant state, chat.
- Host/admin concept: who owns the meeting, server-side host checks.
- Explicit `ParticipantPermission` model (canSpeak, canUseCamera, canShareScreen, canAnnotate, canRequestRemoteControl, remoteControlGranted) with server-side storage and RLS.
- Admin control center (per-participant and global mute/camera/annotation/remote-control controls, remove participant, end meeting).
- Force-mute enforcement at the sender and at every receiver.
- Collaborative annotation engine: vector ops, normalized coordinates, tools (pen, line, rectangle, square, circle, arrow, eraser), undo/redo/clear, op ids, sync, minimal hover toolbar.
- Remote-control control-session token stored server-side, expiry on leave/end/revoke/disconnect, global "disable remote control", host STOP CONTROL button separate from the presenter concept.
- Electron main process with `contextIsolation`, `sandbox`, narrow preload, per-event validation and session arming in the main process, CSP, packaging.
- Voice translation pipeline: capture -> VAD -> streaming STT -> language detection -> translation -> per-participant TTS, original/translated/both audio layers, per-participant preferred language shared with the room, indicators and low-confidence handling.
- Real speaking indicator and audio level metering.
- Connection state UI truthfulness (Connecting / Connected / Reconnecting / Host disconnected).
- Tests for audio/video/screen-share between two real browser pages, annotation sync, permissions, remote control lifecycle, translation with mocked providers.

## 4. Reusable code (keep)

- `useWebRTC.ts` negotiation, retry and diagnostics logic. Extend, do not rewrite.
- `useRemoteControl.ts` state machine, `validation.ts`, `protocol.ts`, `auditLog.ts`, tests. Extend with a pluggable transport and DB-backed token.
- `electron/remoteControlHandler.cjs` key/button mapping and the real-dependency harness.
- `mediaPreflight.ts`, `remoteAudioRecovery.ts`, `webrtcLogger.ts`.
- Presence + join-request flow and their migrations.
- shadcn UI kit, mobile shells, keyboard shortcuts scaffolding.
- Edge functions `translate-text` (as one translation provider) and `elevenlabs-scribe-token` (as one STT provider).

## 5. Required architecture changes

1. Add a data plane (`src/lib/dataPlane/`): one reliable ordered `RTCDataChannel` per peer created by the offerer (`negotiated: true, id: 0` so both sides bind without extra negotiation), a typed message bus with topics (`annotation`, `rc`, `perm`, `chat`, `stt`, `state`), per-message ids for dedupe, and automatic fallback to the Supabase broadcast channel when a channel is not open. Remote control and annotation publish through the bus.
2. Pluggable signaling transport so that WebRTC can be tested in a real browser without Supabase (local `BroadcastChannel` transport for e2e only, never in production).
3. Central `MeetingSession` state in the Zustand store: `hostId`, `hostUserId`, `permissions` by session id, `meetingPermissions` (global toggles), `presenterId`, `remoteControlSession`, `translation` settings, `connection` state. Remove mock participant fields (`hasMouseControl`, `mouseControlRequested`) from the store.
4. Database additions (new migration): `meetings` (host, status, global toggles), `meeting_participant_permissions`, `remote_control_sessions`, `meeting_events` (lightweight audit). RLS: members read, host writes, `SECURITY DEFINER` RPCs for host actions (`end_meeting`, `remove_participant`, `set_participant_permission`, `set_meeting_controls`, `grant_remote_control`, `revoke_remote_control`). All meeting-scoped data is deleted when the meeting ends (ephemeral rule from the product doc).
5. Annotation engine under `src/lib/annotation/` with a pure reducer (testable) and a canvas renderer; a new `AnnotationOverlay` that maps normalized coordinates onto the rendered video content box (letterbox/pillarbox aware).
6. Remote control: transport moved to the data plane, coordinates mapped to the content box, token issued by host and mirrored to `remote_control_sessions`, revoke on any disconnect, no silent restore, Electron main process added and hardened.
7. Translation pipeline under `src/lib/translation/` with provider interfaces (STT, MT, TTS) so browser-native providers (Web Speech API, `speechSynthesis`) and hosted providers (ElevenLabs Scribe, translation edge function, LibreTranslate-compatible endpoint) are swappable via environment configuration. Original audio stays on the media plane; translated audio is a separate local TTS layer with a per-speaker audio mode.
8. AudioWorklet-based level/VAD meter for real speaking indicators and STT gating.

## 6. Security risks

| Risk | Severity | Plan |
|------|----------|------|
| Electron main executes any IPC payload; no session/token check; no main process file at all | High | New `main.cjs` with `sandbox`, `contextIsolation`, `nodeIntegration=false`, CSP; `inputValidation.cjs` with strict schema + control-session arming (`start/stop`) and per-event token check before nut-js. |
| No host authority; any member admits joiners; client could self-grant permissions | High | `meetings.host_user_id`, RLS host checks, RPCs, receivers enforce permissions from the DB rows (not from peer messages). |
| RC "signature" is not authentication | Medium | Keep as integrity/anti-replay; authority comes from DB-backed token + realtime RLS; document clearly. |
| Committed `.env` | Medium | Untrack, add `.env.example`. |
| Public TURN credentials in source | Medium | Move to `VITE_TURN_*` environment variables with the current values as documented defaults for development only. |
| Raw backend errors exposed on login | Low | Map to user-facing messages. |
| No CSP | Medium | Add CSP meta for web and `session.defaultSession.webRequest` headers in Electron. |
| Lovable-specific dependencies (`@lovable.dev/*`, `lovable-tagger`, AI gateway) | Portability | Keep working, but translation provider is abstracted so a self-hosted provider can replace the gateway without code changes. |

## 7. Performance risks

- Mesh topology: O(N^2) connections. Acceptable for 4 to 6 participants; the data plane and media plane separation is designed so an SFU can replace the mesh later without touching annotation/control code.
- Mouse/cursor events through Supabase broadcast (server hop per event). Moving them to the data channel removes the hop.
- Single 1.48 MB bundle: code-split meeting room and translation workers later (not a correctness issue).
- Translation STT/TTS must not run on the React thread: AudioWorklet for capture/VAD, browser recognition/synthesis engines run off-thread natively.
- Annotation rendering must be canvas based with incremental redraw, never DOM per stroke.

## 8. Recommended implementation order (followed in this branch)

1. Fix build/lint/test baseline (B1, B2, B3, B4).
2. Data plane + signaling transport abstraction.
3. Session state + permission model + migrations.
4. Screen share fixes (B5, B6) and presenter state on the data plane.
5. Annotation engine + overlay + permissions.
6. Remote control hardening (B7, B8, B15) + Electron main + admin STOP CONTROL.
7. Admin control center UI.
8. Translation pipeline + preferences + UX.
9. Reconnection and resync.
10. Security hardening, UI/branding per the approved design.
11. Automated tests (unit + real-media Playwright).
12. Final QA document with per-feature evidence.
