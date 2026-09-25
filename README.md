# LiveDesk

To build the "Engine" of Zoom Connect, we need to go deeper than just the folder structure. We must define the exact Data Flow, Memory Management, and Concurrency Models that make WebRTC, AI Inference, and OS-level inputs run simultaneously without choking the CPU or breaching the 1.5-second latency threshold.

Here is the comprehensive blueprint for the core engine of your application.

1. The Core Engine Diagram

The architecture requires strict separation of concerns. The Main process acts only as the OS proxy, while the Renderer acts as the heavy-lifting engine, offloading intensive tasks to Web Workers and Worklets.

[ OS Level ]                                [ Electron Main Process ]
      │                                                │
      ├─> Screen Rendering  <----------------------- (Node.js) Window Management
      │                                                │
      └─> Mouse Hardware    <--- [@nut-tree/nut-js] <--┤ (Strict IPC Validation)
                                                       │
======================== IPC BRIDGE (ContextBridge) ===│========================
                                                       │
[ Electron Renderer Process (React UI Thread) ]        │
      │                                                │
      ├─> 1. UI Rendering (React)                      │
      ├─> 2. WebRTC Mesh Controller (Video/Audio)      │
      │        │                                       │
      │        ├─> RTCDataChannel ---------------------┤ (Sends normalized X,Y)
      │        │
      │        └─> MediaStream (Audio)
      │                │
[ Dedicated Audio Thread ] │
      │                │
      ├─> AudioContext & AudioWorklet (Extracts raw PCM Float32 without blocking UI)
      │                │
      │                v (MessagePort / SharedArrayBuffer)
      │
[ Web Worker Thread ]  │
      │                │
      ├─> VAD (Voice Activity Detection - drops silent frames)
      └─> Transformers.js (Whisper ONNX via WebGPU)

               │
               └─> Emits translated text back to React State (< 1.5s latency)


2. The Networking Engine: WebRTC Mesh & Data Channels

For a Mesh topology (where everyone connects directly to everyone else), you bypass central media servers (SFUs), which inherently provides ultra-low latency.

Media Streams: Use standard RTCPeerConnection for Video and Audio.

Mouse Data: Do not use WebSockets. You must establish an RTCDataChannel alongside the video stream. Ensure you configure it as ordered: false, maxRetransmits: 0 (essentially acting as UDP). If a mouse coordinate packet drops, you don't care; you only care about the latest coordinate.

The Mesh Scalability Rule: Mesh architecture scales at $O(N^2)$. At 5 users, that is 10 connections. At 10 users, it is 45 connections. Limit this app's room size to 4–6 users, or WebRTC encoding will spike CPU usage, drastically delaying your Whisper engine.

3. The AI Translation Engine: Hitting < 1.5s Latency

Running Whisper locally is the biggest threat to your latency. If you use MediaRecorder to save 2-second webm chunks and decode them, you will fail the 1.5s requirement.

The Ultra-Low Latency Pipeline:

AudioWorklet Extraction: Pipe the remote peer's MediaStream into an AudioContext. Use an AudioWorkletNode to extract raw 16kHz Float32 PCM arrays directly.

Voice Activity Detection (VAD): Before sending audio to Whisper, run a lightweight VAD algorithm (like @ricky0123/vad-web). Only trigger Whisper if someone is actually speaking. Passing silence to Whisper burns CPU.

WebGPU Acceleration: Configure Transformers.js to use WebGPU.

// Inside whisper.worker.ts
const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    device: 'webgpu', // CRITICAL for sub-second inference
    dtype: 'q4',      // Quantized 4-bit model to save RAM
});


Ring Buffer: Store audio chunks in a Ring Buffer (or SharedArrayBuffer if cross-origin isolation is enabled). Submit audio windows of ~1.5 seconds to the Web Worker iteratively.

4. The Remote Control Engine: Resolution-Agnostic I/O

The user requesting control and the user granting control likely have different screen resolutions (e.g., 4K vs 1080p).

The Control Loop:

Capture (Renderer): Listen to onMouseMove over the remote video feed.

Normalize: Convert absolute pixels to percentages.

const xPercent = event.nativeEvent.offsetX / videoElement.clientWidth;
const yPercent = event.nativeEvent.offsetY / videoElement.clientHeight;
// Throttle this to ~30 times a second using requestAnimationFrame
dataChannel.send(JSON.stringify({ x: xPercent, y: yPercent }));


Execute (Main Process): The receiving renderer passes these percentages via IPC. The Main Process fetches the actual local screen resolution and multiplies.

// Inside Main Process (ipcHandlers.ts)
ipcMain.on('remote-mouse', (event, { xPercent, yPercent }) => {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    const targetX = width * xPercent;
    const targetY = height * yPercent;

    // Use nut.js to move mouse instantly
    mouse.setPosition(new Point(targetX, targetY));
});


5. High-Security Implementation

Because your app allows Remote Mouse Control and processes raw network streams, security is paramount. A compromised Renderer process means a compromised host machine.

Strict Context Isolation & Sandboxing:

Enable sandbox: true in your BrowserWindow.

Enable contextIsolation: true.

Disable nodeIntegration: false.

Air-Tight Preload Script (The Firewall):
Never use generic IPC channels (e.g., ipcRenderer.send('do-something', args)). Hardcode the exact, narrow APIs allowed.

// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ONLY allow numbers between 0.0 and 1.0
    moveMouse: (x, y) => {
        if (typeof x === 'number' && typeof y === 'number' && 
            x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            ipcRenderer.send('remote-mouse-move', { x, y });
        }
    }
});


Pre-Bundled AI Models (No External Fetching):
By default, Transformers.js tries to download models from HuggingFace. Lock this down. Download the .onnx models during your CI/CD build process, bundle them in your Electron extraResources folder, and point Transformers.js to read from file:// or local paths. Apply a strict CSP (Content Security Policy) that prevents the app from connecting to any domain other than your WebRTC Signaling Server.

6. Expanded Architecture Folder Structure

zoom-connect/
├── src/
│   ├── main/                    # THE SYSTEM PROXY (Node.js)
│   │   ├── core/
│   │   │   ├── WindowManager.ts
│   │   │   └── SecurityCSP.ts
│   │   ├── hw-control/          # Remote Control Engine
│   │   │   └── MouseEngine.ts   # Integrates @nut-tree/nut-js
│   │   └── ipc/
│   │       └── routes.ts        # Strictly validated IPC ingestion
│   │
│   ├── preload/                 # THE FIREWALL
│   │   └── index.ts             # contextBridge definitions
│   │
│   └── renderer/                # THE ENGINE (React + Web Workers)
│       ├── src/
│       │   ├── webrtc/          # Networking Engine
│       │   │   ├── Signaling.ts
│       │   │   ├── PeerConnection.ts
│       │   │   └── DataChannelSync.ts # Handles UDP-like mouse coordinates
│       │   │
│       │   ├── ai-pipeline/     # Translation Engine
│       │   │   ├── WhisperWorker.ts   # Web Worker + WebGPU inference
│       │   │   ├── VADProcessor.ts    # Voice Activity Detection
│       │   │   └── AudioExtractor.js  # AudioWorklet (Raw PCM buffer)
│       │   │
│       │   ├── ui/              # React Interface
│       │   │   ├── Grid/
│       │   │   ├── Subtitles/
│       │   │   └── Overlays/
│       │   └── store/
│       │       └── EngineState.ts     # Zustand/Redux for shared state
│       │
│       └── public/
│           ├── models/          # Local ONNX Whisper Weights (Air-gapped)
│           └── worklets/        # Extracted AudioWorklet files


By strictly implementing this Mesh + DataChannel + WebGPU Worker + Hardened IPC architecture, you will maintain silky-smooth React performance, keep translation lag under 1.5 seconds, and ensure enterprise-grade security for your users. --- This is the most critical part of your "Zoom Connect" performance strategy. If you handle AI inference poorly, your UI will freeze, and your video call will jitter.

To run Whisper locally without killing the user's computer, you must treat your AI Pipeline as a strictly isolated, low-priority resource.

1. Architecture: Web Worker vs. Background Process

The Decision: Use a Web Worker.

Do not use a separate Electron Background Process (Main Process).

Why? Electron’s Main Process should stay lean. Passing raw audio buffers between the Main process and Renderer incurs massive serialization overhead (Structured Clone Algorithm), which will choke your performance and cause stuttering.

The Solution: Use a Web Worker inside the Renderer process.

It shares the same process memory space (sort of) but runs on a separate thread.

It has direct access to the audio buffers without crossing the Electron IPC bridge.

It keeps the UI thread free to handle video decoding and React state updates.

2. RAM & CPU Management Strategy

Whisper is memory-intensive. You must implement a "Budgeted" AI approach:

Quantization (Crucial): Never use the float32 (default) version of whisper-tiny. You must use the Quantized (q4) version. It reduces the memory footprint by ~75% with negligible accuracy loss.

SharedArrayBuffer (SAB): Use SharedArrayBuffer for communication. Instead of sending large data blocks between the UI and Worker, use a pointer to the buffer. This allows both threads to access the same memory location, avoiding copies entirely.

VAD (Voice Activity Detection): Never send "silence" to Whisper.

If you feed 1 second of silence to the model, you waste CPU and battery.

Use a lightweight library like @ricky0123/vad-web in the Renderer. It performs a simple energy check on the audio stream. Only send audio to the Worker when someone is speaking.

3. Optimization Steps for Real-Time Translation

To achieve sub-second latency (the <1.5s goal), you need to optimize the pipeline:

Step A: Setup the Worker (whisper.worker.ts)

Load the model once, keep it in memory, and expose a single processAudio method.

// whisper.worker.ts
import { pipeline, env } from '@xenova/transformers';

// 1. Force the model to use the local file system (no HTTP fetches)
env.allowLocalModels = true;
env.useBrowserCache = true;

let transcriber = null;

// 2. Initialize in a separate promise to avoid UI blocking
const init = async () => {
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        device: 'webgpu', // Use the GPU for inference
        dtype: 'q4',      // 4-bit quantization
    });
};

self.onmessage = async (e) => {
    if (!transcriber) await init();
    
    // Process audio buffer
    const result = await transcriber(e.data.audioBuffer, {
        chunk_length_s: 15,
        stride_length_s: 3,
        // Optional: Provide language hint to speed up decoding
        language: 'english', 
    });
    
    self.postMessage(result.text);
};


Step B: The Audio Pipeline (Renderer Thread)

You need to capture audio from the WebRTC stream without recording files to disk.

// audio/pipeline.ts
const audioCtx = new AudioContext({ sampleRate: 16000 }); // Whisper expects 16k
const source = audioCtx.createMediaStreamSource(remoteStream);

// Create an AudioWorkletProcessor to stream raw audio chunks
await audioCtx.audioWorklet.addModule('audioProcessor.js');
const processor = new AudioWorkletNode(audioCtx, 'audio-processor');

processor.port.onmessage = (event) => {
    // Check if voice is detected (VAD logic here)
    if (isVoiceDetected(event.data)) {
        // Send to worker via transferrable object (Zero Copy)
        whisperWorker.postMessage({ audioBuffer: event.data }, [event.data.buffer]);
    }
};


4. Checklist for RAM Stability

FeatureActionQuantizationForce dtype: 'q4' in Transformers.js config.Model SizeStick to whisper-tiny. Even base will cause memory spikes on lower-end machines.Buffer ManagementUse Transferrable Objects (postMessage(data, [data.buffer])). This moves the data instead of copying it.Process PriorityUse navigator.scheduling.isInputPending() in your React render loop. If the UI is busy, delay the subtitle update by 100ms.Garbage CollectionExplicitly nullify the audio buffers in your Worker after inference is complete to ensure the JS Garbage Collector clears the RAM.

5. Final Performance "Killer" Tip: WebGPU

Modern browsers (and Electron) support WebGPU. Ensure your package.json for Electron enables the necessary flags:

// main.ts
app.commandLine.appendSwitch('enable-features', 'WebGPUSurfaceTexture');
app.commandLine.appendSwitch('enable-unsafe-webgpu'); // Required for some environments


Summary of the flow:

Capture: Raw PCM audio from WebRTC MediaStream.

Filter: VAD removes silence (saves 40% CPU).

Transfer: Send raw buffer to Web Worker (Zero-Copy Transfer).

Infer: Quantized whisper-tiny model (WebGPU) generates text.

Render: Subtitles update in React via a lightweight state update.

By using this "Zero-Copy" worker approach, you minimize RAM spikes and keep the video call smooth. -- - To protect "Zoom Connect," you need a two-layered defense: Code Obfuscation/Bytecode Compilation (to make it harder to read your source) and Hardware-Locked Licensing (to prevent piracy).

1. Protecting Source Code with Bytenode (V8 Bytecode)

Electron apps are shipped as simple .asar archives, which are easily extracted. bytenode compiles your JavaScript into V8 bytecode, which is not human-readable and cannot be easily "unpacked" like source code.

The Build Pipeline Strategy:

You cannot compile everything to bytecode (some parts, like your entry point, need to be readable by the Node.js loader). You must compile your "Business Logic" files only.

Step 1: Install Dependencies

npm install --save-dev bytenode


Step 2: Create a Compilation Script (build-bytecode.js)
This script iterates through your source code and compiles .js files into .jsc (bytecode) files.

const bytenode = require('bytenode');
const v8 = require('v8');
const fs = require('fs');
const path = require('path');

// Configure V8 to support bytecode
v8.setFlagsFromString('--no-lazy');

// Compile a specific file
bytenode.compileFile({
  filename: './dist/services/MouseController.js', // Your sensitive logic
  output: './dist/services/MouseController.jsc'
});


Step 3: Modify the Entry Point
In your Electron Main process, you need a custom loader to execute .jsc files instead of .js.

// main/index.ts
const bytenode = require('bytenode');

// Instead of require('./services/MouseController.js')
require('./services/MouseController.jsc'); 


Step 4: Integration with Electron-Builder
In your electron-builder.yml, configure it to ignore the source .js files and include the .jsc files:

files:
  - "!src/**/*"      # Exclude source
  - "dist/**/*.jsc"  # Include compiled
  - "dist/**/*.js"   # Keep only the minimal entry points


2. Hardware Fingerprinting & Licensing (The "Killer" Setup)

To prevent a user from sharing their license key, you must derive a Hardware ID (HWID) from their unique machine characteristics and register it against their key on your Laravel API.

Step A: Generate the Hardware Fingerprint

Use the node-machine-id library to generate a consistent hash based on the machine's motherboard, CPU, and UUID.

npm install node-machine-id


// main/services/LicenseManager.ts
import { machineId } from 'node-machine-id';

async function getDeviceFingerprint() {
  // Pass 'true' to expose original ID (optional, hash is safer)
  const id = await machineId(); 
  return id; // Unique string like: "61331776-7977-4952-b911-378385750212"
}


Step B: The Authentication Flow (Electron ↔ Laravel)

User Logs In: User enters their License Key in your Electron app.

App Sends Data: App sends the License Key + Device Fingerprint to your Laravel API.

Laravel API Logic:

Lookup: Find the license key in the database.

Verify:

If license.fingerprint is NULL, bind the current device_fingerprint to the license.

If license.fingerprint exists, compare it with the incoming request.

If they match, return success.

If they don't match, return 403 Forbidden (License already in use).

Example Laravel Controller:

public function verifyLicense(Request $request) {
    $license = License::where('key', $request->license_key)->first();

    if (!$license) return response()->json(['error' => 'Invalid'], 401);

    if (is_null($license->fingerprint)) {
        // First time activation
        $license->update(['fingerprint' => $request->device_id]);
        return response()->json(['status' => 'activated']);
    }

    if ($license->fingerprint !== $request->device_id) {
        return response()->json(['error' => 'License already bound to another machine'], 403);
    }

    return response()->json(['status' => 'valid']);
}


3. Critical Security Considerations

Don't Ship the License Check logic in plain text: If you use the bytecode approach above, compile your LicenseManager.ts (or the logic that contacts your API) into .jsc. This prevents hackers from commenting out the if (licenseValid) check.

Network Spoofing: A sophisticated hacker will use tools like Fiddler or Charles Proxy to spoof the response from your Laravel API (e.g., they will trick your app into thinking the server returned "200 OK").

Counter-measure: Use SSL Pinning (or strict HTTPS) and sign your API responses. Your app should expect an encrypted/signed response from the server that it decrypts using a key bundled in your .jsc bytecode.

Code Obfuscation: Combine bytenode with javascript-obfuscator for the files that cannot be compiled to bytecode (like your React UI code).

Install: npm install --save-dev javascript-obfuscator

This renames variables to random strings (e.g., processPayment becomes _0x4a2b), making it virtually impossible for a human to understand the flow.

Recommended Toolset Summary:

Compilation: bytenode (For critical business logic).

Obfuscation: javascript-obfuscator (For the UI and front-end logic).

Fingerprinting: node-machine-id (Reliable HWID).

Validation: Laravel API with a "Bind-on-First-Use" database strategy. ---- UI/UX Specification for Interface (The Face)

This UI/UX specification adheres to Google Material Design 3 (M3) principles, focusing on a clean, "trust-building" professional interface. The goal is to maximize screen real-estate for video while keeping the AI controls non-intrusive.
1. Design System: Material Blue & White
This palette uses Google’s signature "Trust Blue" and neutral surfaces to reduce eye strain during long meetings.
Color Palette:
Brand Primary (Blue): #1A73E8 (Used for active states, buttons, primary actions)
Surface (Background): #FFFFFF (White)
Surface Variant (Grid Tiles): #F1F3F4 (Light grey for inactive video placeholders)
On-Surface (Primary Text): #202124 (Dark charcoal for high readability)
On-Surface (Secondary Text): #5F6368 (Grey for subtitles and timestamps)
Danger (Mute/Disconnect): #D93025 (Red)
Success (AI Active): #188038 (Green)
Typography:
Font: Google Sans or Roboto
H1-H3: Bold, 20px - 24px (Participant Names)
Body: 14px - 16px (Subtitles, labels)

2. Component Hierarchy (React Structure)
ZoomConnectApp
├── NavigationBar (Top - App Title, Meeting ID, Clock)
├── Workspace (Flex Container)
│   ├── VideoGridArea (Flex: 1)
│   │   ├── VideoTile (x9 grid)
│   │   └── FloatingControlBar (Position: Absolute, Bottom)
│   └── Sidebar (Width: 320px, Collapsible)
│       ├── AIStatusIndicator
│       ├── TranslationLog (Scrollable Area)
│       └── SettingsPanel


3. Layout Specifications
A. 3x3 Video Grid
The grid should be responsive using CSS Grid, ensuring tiles maintain a 16:9 aspect ratio regardless of the window size.
CSS Implementation:
 .video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 12px;
  padding: 16px;
  height: 100vh;
}

.video-tile {
  background-color: #202124; /* Black background for video */
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  position: relative;
}


B. Sidebar (AI Translation Settings)
The sidebar should feel like a "drawer." It slides in with a slight ease-in-out transition.
Layout: Fixed width of 320px.
Style: White background (#FFFFFF), subtle left-border shadow (-2px 0 5px rgba(0,0,0,0.05)).
Internal Elements:
Header: "AI Assistant" (Bold, 18px).
Toggle: A Material Design "Switch" component for Enable Translation.
Transcript Log: A scrollable div containing timestamped text:
Format: [00:01] John: "Hello everyone..."
Highlight: Active speaker text is rendered in @202124, past logs in #5F6368.
C. Floating Bottom Bar
This bar should be elevated (floating) above the video grid to maintain a modern, uncluttered look.
CSS Implementation:
 .control-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background-color: #FFFFFF;
  padding: 12px 24px;
  border-radius: 50px;
  display: flex;
  gap: 20px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  z-index: 100;
}


Icons (Material Symbols/Icons):
mic (Click to toggle)
videocam (Click to toggle)
present_to_all (Screen Share)
settings_remote (Request Mouse Control - Highlighted in Blue)
call_end (Red background, white icon)

4. UI Interaction Logic (The "Professional" Touch)
AI Subtitle Overlay: When Enable Translation is on, display the subtitles as a semi-transparent white glassmorphism banner at the bottom of the active speaker's video tile, rather than just in the sidebar. This keeps the user focused on the speaker.


Style: background: rgba(0,0,0,0.6); color: #FFFFFF; backdrop-filter: blur(4px);
Mouse Control State: When a user requests mouse control, the border of their video tile should glow with a soft blue ring (border: 2px solid #1A73E8;). This provides visual confirmation to all participants that "this user is currently controlling the host's desktop."


Latency Indicator: Add a small "Network Quality" icon in the top right corner of the window.


Green: < 200ms latency.
Yellow: < 500ms.
Red: > 1000ms.
This builds user trust, as they will understand why the video might be lagging.
5. Summary Checklist for Frontend Implementation
[ ] Container: Use display: flex for the sidebar-content split.
[ ] Theme: Apply the colors defined above to your ThemeProvider (Material-UI or Tailwind config).
[ ] Shadows: Use elevation-3 for the floating bar and elevation-1 for video cards.
[ ] Responsive: Ensure the 3x3 grid becomes a 2x2 or 1x1 stack if the window is resized to a smaller width.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://livedesk0000.lovable.app

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
