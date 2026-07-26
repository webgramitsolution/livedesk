# Google Meet + AnyDesk hybrid — Remote Interaction Layer

Aap ki requirement clear hai. Browser aur Electron dono par kaam karna hai, isliye main **do layer** me feature banaunga taaki koi bhi participant AnyDesk/TeamViewer khole bina meeting ke andar hi interact kar sake.

---

## Do layer approach

### Layer 1 — Live Collaborative Cursor + Click Highlight (sab browsers me chalega)
Screen share ke upar ek transparent overlay lagega jispar har viewer ka cursor real-time dikhega (naam + color).
- Presenter aur viewers dono apna cursor share dikha sakein.
- Click karne par ripple/pulse animation us exact spot par (jaise "yahan dekho").
- Optional laser-pointer mode (cursor short trail).
- Data channel ke through normalized coordinates (0-1) bheje jayenge — resolution independent.

Yeh **hamesha** on rehta hai jab bhi koi screen share kar raha ho. Isse "ye button dikh raha hai?" wala use-case turant solve hota hai — client apna cursor us button pe le jaayega aur host dekh lega.

### Layer 2 — Request / Grant Real Remote Control
Jab sirf point karna kaafi na ho, tab actual mouse+keyboard control:

- **Browser presenter (Chrome/Edge desktop):** Chrome ka experimental Capture Controller + input injection kaam nahi karta cross-origin/OS pe. Isliye browser me control receive karna limited hai — hum sirf **overlay clicks/scroll ko presenter ke browser tab** ke andar dispatch kar sakte hain (postMessage-style synthetic events). OS-wide control nahi milta browser me — yeh Chrome/Meet ki bhi limitation hai.
- **Electron presenter (recommended for full AnyDesk-like control):** `nut.js` (already in memory `mem://features/remote-control`) ke through OS-wide mouse move, click, scroll, keyboard events perform honge. Coordinates normalized aaenge, presenter side pe screen size ke hisaab se map hoke fire hongi.

App khud detect karega: agar presenter Electron build par hai → "Full remote control" available. Agar browser par hai → "Cursor + in-tab control only" (with tooltip explaining why).

---

## Control flow (UX)

```text
Viewer                           Presenter
  │                                 │
  │  clicks 🖐 "Request Control"    │
  │────────────────────────────────►│
  │                                 │  toast: "Rahul wants control"
  │                                 │  [Accept] [Deny]
  │◄────── granted ─────────────────│
  │                                 │
  │  moves mouse, clicks, types     │
  │═══► data channel ═══════════════►│ → nut.js / in-tab dispatch
  │                                 │
  │                                 │  presenter can hit ESC or
  │                                 │  click "Reclaim Control" anytime
  │◄────── revoked ─────────────────│
```

Rules:
- Ek time me ek controller (presenter can queue but only one active).
- Presenter ke `ESC` / mouse-jiggle threshold / "Reclaim" button — instant revoke.
- Auto-revoke on: screen share stop, tab blur > 10s, controller disconnect, meeting end.
- Har grant/revoke event event-log me jayega (aap ka existing `webrtcLogger`).

---

## What I will build

**New UI**
- `RemoteControlOverlay.tsx` — full-bleed transparent overlay over the shared-screen `<video>`. Captures pointer/keyboard when controlling; renders remote cursors when just viewing.
- `RemoteCursorLayer.tsx` — renders every participant's live cursor with name pill + click ripple.
- `RemoteControlButton.tsx` — in the video tile of the presenter: "Request Control" for viewers, "Give Control" menu for presenter.
- `RemoteControlBanner.tsx` — top-of-screen banner: "Rahul is controlling your screen — Reclaim (Esc)".
- Toast/consent prompt for the presenter.

**New logic**
- `src/lib/remoteControl/protocol.ts` — typed messages: `cursor`, `click`, `scroll`, `key`, `request`, `grant`, `revoke`, `heartbeat`.
- `src/hooks/useRemoteControl.ts` — state machine (idle → requesting → controlling / granted / revoked), WebRTC DataChannel transport (piggybacks on existing peer connections from `useWebRTC`).
- `src/lib/remoteControl/coordinates.ts` — normalize/denormalize between viewer overlay and presenter screen (uses `videoWidth/Height` + `getBoundingClientRect`).
- `src/lib/remoteControl/electronBridge.ts` — behind `window.electronAPI?.remoteControl` guard; calls nut.js in main process. Pure no-op in browser.
- Electron main process handler (`electron/remoteControl.cjs`) with nut.js — only touched if you confirm Electron packaging is in scope; otherwise stubbed for later.

**Existing files touched**
- `useWebRTC.ts` — expose data channel per peer + attach remote-control message router.
- `VideoTile.tsx` — mount overlay on the presenter's screen-share tile; show controller badge.
- `FloatingControlBar.tsx` — add "Remote Control" pill (permissions + status).
- `PerformanceHud.tsx` — surface control latency (RTT of last input).
- `webrtcLogger.ts` — log grant/revoke/input-rate.

**Security**
- Grant is presenter-signed (nonce + timestamp) so a malicious peer can't forge inputs.
- All input messages validated against active grant on the presenter side before dispatch.
- Presenter can toggle "Allow keyboard" separately from "Allow mouse".

---

## Technical notes (for reference)

- Transport: WebRTC `RTCDataChannel` per peer (ordered=false, maxRetransmits=0) for cursor; ordered=true for control events. No Supabase round-trip → sub-100ms input latency.
- Coordinate model: send `{x: 0..1, y: 0..1, button, dx, dy, key, mods}`. Presenter maps to real pixels using the shared video's intrinsic size (Electron) or the visible tab rect (browser fallback).
- Throttling: cursor at 60Hz → coalesced to 30Hz for send; clicks/keys unthrottled.
- Browser-only fallback for "control": we inject synthetic events into the presenter's tab via a hidden iframe-less dispatcher — works only inside the meeting app UI, NOT the OS. This is documented in the UI as "In-app pointer only — install desktop app for full control".
- Electron path: `nut.js` `mouse.setPosition`, `mouse.click`, `keyboard.type`, `keyboard.pressKey`. Runs in main process via `ipcMain.handle('remote-control:event', ...)`.

---

## Rollout order (I'll do steps 1–3 in this turn if you approve)

1. Live shared cursor + click ripple over screen share (works everywhere, instant win).
2. Request / Grant / Revoke UX + banner + presenter consent.
3. Browser in-tab control dispatch (limited but useful for web-app support demos).
4. Electron `nut.js` bridge (real OS control) — needs your Electron build confirmation.

Confirm karo — main step 1–3 abhi build karta hoon, aur step 4 ke liye Electron packaging enable karne se pehle ek chhoti confirmation lunga.
