# Implementation Plan

Five focused changes — frontend-heavy, plus one small backend table for the host-approval waiting room.

## 1. Waiting Room (host approves before member joins)

**Backend (new table `meeting_join_requests`):**
- Columns: `id`, `meeting_code`, `requester_user_id`, `requester_session_id`, `display_name`, `status` (`pending` | `approved` | `denied`), `created_at`, `decided_at`.
- RLS: requester can insert/select own row; existing host (first member of `meeting_presence` for that code, or any current member via `is_meeting_member`) can select & update rows for their meeting.
- Realtime: enable on the table.

**Frontend flow:**
- When a non-host clicks "Join", instead of going straight to `connecting`, insert a `pending` row and show a new `WaitingRoomScreen` ("Waiting for host to admit you…", with Cancel button).
- Member subscribes to their own row; on `approved` → proceed to `joinMeeting()`. On `denied` → toast + back to lobby.
- Host (already in meeting) subscribes to pending requests for the current `meetingId`. New `JoinRequestToast` appears top-right with Admit / Deny buttons (also surfaced inside `ParticipantPanel` as a "Waiting (N)" section).
- Host detection: if no presence row exists yet for that code → user becomes host directly (no waiting).

## 2. Swipe Gestures + Thumb-Friendly Panels

- Add `useSwipeGesture` hook (touchstart/move/end, threshold ~60px, ignore vertical scroll).
- `MeetingRoom` mobile-only swipe handler on the main video area: swipe-left opens AI sidebar (cycles ai → participants → chat with subsequent swipes), swipe-right closes.
- Increase tap targets in `AISidebar`, `ChatPanel`, `ParticipantPanel` headers to `min-h-12`, larger close button (`w-11 h-11`), bigger spacing (`gap-3`, `p-5` on mobile).
- Control bar already `fixed` and centered via `left-1/2 -translate-x-1/2`; verify no panel-driven shift remains.

## 3. Annotation Delete / Close Fix

In `WhiteboardOverlay.tsx`:
- Refactor "Clear" handler: store strokes in a ref + state, on click call `clearCanvas()` that resets ref, state, and re-renders the canvas with `clearRect(0,0,w,h)`. Stop event propagation so canvas pointer handlers don't swallow the click.
- Close (X) button: bound to a top-level `pointer-events-auto` toolbar div positioned `fixed top-4 right-4 z-[70]` so it sits above the canvas. Closes overlay via store flag and also clears strokes.
- Touch fix: add `touch-action: none` to canvas, add `pointerup`/`pointercancel` listeners (not just `mouseup`) so mobile drawings finish cleanly.

## 4. Performance HUD (toggle in Settings)

- Add `showPerfHud: boolean` to `meetingStore` (persisted).
- `SettingsModal`: new toggle row "Show performance HUD" under existing settings.
- New `PerformanceHud.tsx`:
  - Polls `RTCPeerConnection.getStats()` every 1s for first remote peer in `useWebRTC` (expose via a small ref/hook): outbound video FPS, inbound packet-loss %, RTT.
  - Reads AI latency from `useLiveTranscription` (add a `lastLatencyMs` exported value — measured between speech start and transcript dispatch).
  - Renders a compact pill: `FPS 30 · Loss 0.4% · AI 820ms`, color-coded (green <1500ms, amber 1500-2500, red >2500). Position: `fixed top-2 left-1/2 -translate-x-1/2` mobile, `top-4 right-4` desktop.

## 5. E2E Refresh Test (mobile viewport)

- New `src/test/refresh-persistence.test.ts` using vitest + jsdom.
- Steps: seed `sessionStorage` with `zoom-connect-active-meeting` snapshot (screen=meeting, meetingId, mic off, panel=chat, controlBarCollapsed=true) → `import('@/store/meetingStore')` fresh → assert state matches.
- Second test: call `joinExistingMeeting` → mutate `toggleMic` / `setRightPanel` → re-import store (via `vi.resetModules()`) → assert hydrated values.
- Third test: call `leaveMeeting` → assert sessionStorage key removed and screen=`lobby`.

## Technical Notes

- WebRTC stats: expose `peerConnectionsRef` from `useWebRTC` via a returned `getStats()` function so `PerformanceHud` can read without coupling.
- Waiting-room realtime: use channel name `join-requests:${meetingId}`; cleanup on unmount.
- Swipe hook lives in `src/hooks/useSwipeGesture.ts`, no new deps.
- `mem://` not updated — these are feature additions, not new permanent rules.

## Files

**New:** `src/hooks/useSwipeGesture.ts`, `src/components/meeting/PerformanceHud.tsx`, `src/components/meeting/WaitingRoomScreen.tsx`, `src/components/meeting/JoinRequestNotifier.tsx`, `src/test/refresh-persistence.test.ts`, one migration.

**Edited:** `meetingStore.ts`, `MeetingRoom.tsx`, `WhiteboardOverlay.tsx`, `SettingsModal.tsx`, `AISidebar.tsx`, `ChatPanel.tsx`, `ParticipantPanel.tsx`, `LobbyScreen.tsx` (route to waiting room), `useWebRTC.ts` (expose stats), `useLiveTranscription.ts` (latency export), `Index.tsx` (render WaitingRoomScreen).
