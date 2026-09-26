# LiveDesk

Meet. Collaborate. Control.

LiveDesk is a hybrid meeting and remote-support platform: live audio/video meetings, screen sharing, collaborative annotation over the shared screen, permission-based remote control (OS level in the desktop app), and real-time voice translation into each participant's preferred language.

## Documentation

- `docs/LIVEDESK-IMPLEMENTATION-AUDIT.md`: repository audit before the implementation.
- `docs/LIVEDESK-FINAL-QA.md`: per-feature status, tests and known limitations.
- `electron/README-remote-control.md`: desktop app and remote-control security model.
- `docs/SECURITY_CHANGELOG.md`: security fixes log.

## Architecture

```
Browser / Electron renderer (React + Zustand)
  Media plane   RTCPeerConnection mesh (audio, video, screen)            src/hooks/useWebRTC.ts
  Data plane    RTCDataChannel bus + Supabase broadcast fallback          src/lib/dataPlane
                topics: annotation, rc, chat, stt, state, perm, sys
  Signaling     Supabase Realtime (prod) or BroadcastChannel (tests)      src/lib/signaling
  Annotation    normalized vector ops, reducer, canvas renderer           src/lib/annotation
  Remote ctrl   request/grant state machine, tokens, validation           src/hooks/useRemoteControl.ts, src/lib/remoteControl
  Translation   STT -> MT -> TTS providers, VAD worklet                   src/lib/translation, public/worklets
  Permissions   ParticipantPermission model + RPC wrappers                src/lib/permissions
Backend (Supabase / PostgreSQL)
  meetings, meeting_presence, meeting_join_requests,
  meeting_participant_permissions, remote_control_sessions               supabase/migrations
  translate-text, elevenlabs-scribe-token edge functions                  supabase/functions
Desktop (Electron)
  main.cjs (hardened window, CSP, source picker), preload.cjs (narrow),
  remoteControlHandler.cjs (session-armed nut-js execution)               electron/
```

## Setup

```sh
npm install
cp .env.example .env      # fill in the Supabase values
supabase db push          # apply migrations to your project
npm run dev               # http://localhost:8080
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm run build` | Vite dev server / production build (CSP injected at build time) |
| `npm test` | Vitest unit tests |
| `npm run test:e2e:media` | Real-media browser suite (two pages, real WebRTC, no backend). Set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a pre-installed Chromium. |
| `npm run test:electron` | Real nut-js harness under xvfb |
| `npm run electron:dev` | Desktop shell against the dev server |
| `npm run electron:build` | Package the desktop app (electron-builder) |

## Environment

See `.env.example`. Optional: `VITE_TURN_*` (recommended for production), `VITE_TRANSLATION_PROVIDER` (`supabase-fn` or `libretranslate`), `VITE_E2E_LOCAL_SIGNALING=1` for two-tab local development without a backend.

## Ephemeral meetings

Chat, annotations, permissions, control sessions and presence exist only while the meeting is active and are cleared when the host ends it. Recording is optional and stays on the recording participant's device.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7bd6b9f7-70fc-4d62-835e-1ff3368be3aa).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
