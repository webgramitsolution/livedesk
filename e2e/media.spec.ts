import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Real-media end-to-end suite.
 *
 * Two pages share one browser context so BroadcastChannel signaling works;
 * WebRTC media and data channels are real (fake capture devices provide a
 * synthetic tone and test pattern). Evidence is taken from RTCPeerConnection
 * statistics, live <video>/<audio> elements and canvas pixels, not from UI
 * state alone.
 */

const MEETING = 'e2e-media-1';
const HOST_SESSION = 'sess-host';
const MEMBER_SESSION = 'sess-member';

type Snapshot = {
  peers: Array<{
    peerId: string;
    connectionState: string;
    stats: Array<Record<string, unknown>>;
  }>;
};

async function seed(page: Page, sessionId: string, role: 'host' | 'member', name: string) {
  await page.addInitScript(
    ({ sessionId, role, name, meeting, hostSession }) => {
      window.sessionStorage.setItem('livedesk-e2e-role', role);
      window.sessionStorage.setItem('livedesk-e2e-host-session', hostSession);
      window.sessionStorage.setItem(
        'zoom-connect-active-meeting',
        JSON.stringify({
          screen: 'meeting',
          meetingId: meeting,
          meetingSessionId: sessionId,
          userName: name,
          meetingJoinedAt: Date.now(),
          isMicOn: true,
          isCameraOn: true,
          isNoiseCancellationOn: false,
          selectedBackground: 'none',
          selectedLanguage: 'en',
          selectedAudioInput: 'default',
          selectedAudioOutput: 'default',
          selectedVideoInput: 'default',
          selectedAiModel: 'default',
          rightPanel: null,
          isControlBarCollapsed: false,
          showPerfHud: false,
        }),
      );
      window.localStorage.removeItem('livedesk-translation');
    },
    { sessionId, role, name, meeting: MEETING, hostSession: HOST_SESSION },
  );
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const dbg = (window as unknown as { __LIVEDESK_DEBUG__?: { getDiagnosticsSnapshot: () => Promise<unknown> } }).__LIVEDESK_DEBUG__;
    if (!dbg) throw new Error('debug hook missing');
    return (await dbg.getDiagnosticsSnapshot()) as Snapshot;
  });
}

async function inboundBytes(page: Page, kind: 'audio' | 'video'): Promise<number> {
  const snap = await snapshot(page);
  let total = 0;
  for (const peer of snap.peers) {
    for (const report of peer.stats) {
      if (report.type === 'inbound-rtp' && (report.kind === kind || report.mediaType === kind)) {
        total += Number(report.bytesReceived ?? 0);
      }
    }
  }
  return total;
}

async function waitForInbound(page: Page, kind: 'audio' | 'video', minBytes = 2000) {
  await expect.poll(() => inboundBytes(page, kind), { timeout: 40_000, message: `${kind} bytes received` }).toBeGreaterThan(minBytes);
}

async function openPair(context: BrowserContext) {
  const host = await context.newPage();
  const member = await context.newPage();
  await seed(host, HOST_SESSION, 'host', 'Host Vikas');
  await seed(member, MEMBER_SESSION, 'member', 'Member Rahul');
  await host.setViewportSize({ width: 1280, height: 800 });
  await member.setViewportSize({ width: 1024, height: 900 });
  await host.goto('/app', { waitUntil: 'domcontentloaded' });
  await member.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(host.getByTestId('connection-chip')).toHaveAttribute('data-state', 'connected', { timeout: 40_000 });
  await expect(member.getByTestId('connection-chip')).toHaveAttribute('data-state', 'connected', { timeout: 40_000 });
  return { host, member };
}

test.describe('LiveDesk real media', () => {
  test('audio and video flow in both directions between host and member', async ({ context }) => {
    const { host, member } = await openPair(context);

    // Real RTP audio+video arriving on both sides (fake devices produce a tone + pattern).
    await waitForInbound(member, 'audio');
    await waitForInbound(host, 'audio');
    await waitForInbound(member, 'video');
    await waitForInbound(host, 'video');

    // The member's remote audio element carries a live track and plays.
    const audioState = await member.evaluate(() => {
      const el = document.querySelector<HTMLAudioElement>('audio[data-remote-audio="true"]');
      const stream = el?.srcObject as MediaStream | null;
      const track = stream?.getAudioTracks()[0];
      return { present: !!el, live: track?.readyState === 'live', paused: el?.paused ?? true, muted: el?.muted ?? true };
    });
    expect(audioState.present).toBe(true);
    expect(audioState.live).toBe(true);
    expect(audioState.muted).toBe(false);

    // Mute on the host: the outgoing audio track is disabled (real track state), not just UI.
    await host.getByRole('button', { name: 'Mute' }).click();
    const hostTrackEnabled = await host.evaluate(() => {
      const el = document.querySelector<HTMLVideoElement>('video');
      const stream = el?.srcObject as MediaStream | null;
      return stream?.getAudioTracks()[0]?.enabled;
    });
    expect(hostTrackEnabled).toBe(false);
    await host.getByRole('button', { name: 'Unmute' }).click();
  });

  test('screen share reaches the member without mirror recursion, annotations sync with correct position, remote control round-trips', async ({ context }) => {
    const { host, member } = await openPair(context);
    await waitForInbound(member, 'video');

    // --- Screen share (host -> member) ---
    await host.getByRole('button', { name: 'Screen share' }).click();
    const memberScreen = member.getByTestId('screen-share-video');
    await expect(memberScreen).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => memberScreen.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => memberScreen.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2), { timeout: 30_000 }).toBe(true);
    // No self-capture: the host shares "Entire screen", so no mirror warning/placeholder appears.
    await expect(host.getByTestId('self-capture-placeholder')).toHaveCount(0);
    const hostSelfCapture = await host.evaluate(() => (window as unknown as { __LIVEDESK_DEBUG__: { store: { getState: () => { isSelfCapture: boolean } } } }).__LIVEDESK_DEBUG__.store.getState().isSelfCapture);
    expect(hostSelfCapture).toBe(false);

    // --- Annotation (host draws a circle; member sees it at the same normalized position) ---
    await host.getByTestId('control-annotate').click();
    await expect(host.getByTestId('annotation-toolbar')).toBeVisible();
    await host.getByTestId('annotation-tool-circle').click();
    await expect(host.getByTestId('annotation-canvas')).toHaveAttribute('style', /pointer-events: auto/);
    const hostVideoBox = await host.getByTestId('screen-share-video').boundingBox();
    expect(hostVideoBox).not.toBeNull();
    // Draw inside the painted video area (content box is measured on both sides).
    const contentBox = await host.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="screen-share-video"]')!;
      const r = v.getBoundingClientRect();
      const ir = v.videoWidth / v.videoHeight;
      const er = r.width / r.height;
      if (ir > er) {
        const h = r.width / ir;
        return { x: r.left, y: r.top + (r.height - h) / 2, w: r.width, h };
      }
      const w = r.height * ir;
      return { x: r.left + (r.width - w) / 2, y: r.top, w, h: r.height };
    });
    const start = { x: contentBox.x + contentBox.w * 0.3, y: contentBox.y + contentBox.h * 0.3 };
    const end = { x: contentBox.x + contentBox.w * 0.5, y: contentBox.y + contentBox.h * 0.5 };
    await host.mouse.move(start.x, start.y);
    await host.mouse.down();
    await host.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
    await host.mouse.move(end.x, end.y, { steps: 5 });
    await host.mouse.up();

    const redBounds = async (page: Page) =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="annotation-canvas"]');
        const video = document.querySelector<HTMLVideoElement>('[data-testid="screen-share-video"]');
        if (!canvas || !video) return null;
        const ctx = canvas.getContext('2d')!;
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            if (data[i + 3] > 40 && data[i] > 150 && data[i + 1] < 120 && data[i + 2] < 120) {
              count += 1;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (count === 0) return { count: 0 };
        const dpr = window.devicePixelRatio || 1;
        const r = video.getBoundingClientRect();
        const ir = video.videoWidth / video.videoHeight;
        const er = r.width / r.height;
        const box = ir > er
          ? { x: 0, y: (r.height - r.width / ir) / 2, w: r.width, h: r.width / ir }
          : { x: (r.width - r.height * ir) / 2, y: 0, w: r.height * ir, h: r.height };
        const cx = ((minX + maxX) / 2 / dpr - box.x) / box.w;
        const cy = ((minY + maxY) / 2 / dpr - box.y) / box.h;
        return { count, cx, cy };
      });

    await expect.poll(async () => (await redBounds(host))?.count ?? 0).toBeGreaterThan(50);
    await expect.poll(async () => (await redBounds(member))?.count ?? 0, { timeout: 20_000 }).toBeGreaterThan(50);
    const hostShape = (await redBounds(host)) as { cx: number; cy: number };
    const memberShape = (await redBounds(member)) as { cx: number; cy: number };
    // Centre of the circle at ~ (0.4, 0.4) of the presentation on BOTH screens (different viewport sizes).
    expect(Math.abs(hostShape.cx - 0.4)).toBeLessThan(0.05);
    expect(Math.abs(hostShape.cy - 0.4)).toBeLessThan(0.05);
    expect(Math.abs(memberShape.cx - hostShape.cx)).toBeLessThan(0.04);
    expect(Math.abs(memberShape.cy - hostShape.cy)).toBeLessThan(0.04);

    // Undo on the host clears it everywhere; redo brings it back.
    await host.getByTestId('annotation-undo').click();
    await expect.poll(async () => (await redBounds(member))?.count ?? 0).toBe(0);
    await host.getByTestId('annotation-redo').click();
    await expect.poll(async () => (await redBounds(member))?.count ?? 0).toBeGreaterThan(50);
    await host.getByTestId('annotation-exit').click();

    // --- Remote control: request -> approve -> input executes on host -> Esc revokes ---
    const controlButton = member.getByTestId('control-remote');
    await expect(controlButton).toBeVisible({ timeout: 20_000 });
    await controlButton.click();
    await expect(host.getByText('Control requests (1)')).toBeVisible({ timeout: 20_000 });
    await host.getByRole('button', { name: 'Mouse+Keys' }).click();
    await expect(member.getByRole('button', { name: 'Release control' })).toBeVisible({ timeout: 20_000 });
    await expect(host.getByTestId('rc-active-banner').or(host.getByText(/is controlling/))).toBeVisible();

    const executedBefore = await host.evaluate(() => (window as unknown as { __LIVEDESK_DEBUG__: { executedInputs: () => number } }).__LIVEDESK_DEBUG__.executedInputs());
    const memberVideoBox = (await memberScreen.boundingBox())!;
    await member.mouse.move(memberVideoBox.x + memberVideoBox.width * 0.5, memberVideoBox.y + memberVideoBox.height * 0.5);
    await member.mouse.move(memberVideoBox.x + memberVideoBox.width * 0.6, memberVideoBox.y + memberVideoBox.height * 0.55, { steps: 10 });
    await member.mouse.click(memberVideoBox.x + memberVideoBox.width * 0.6, memberVideoBox.y + memberVideoBox.height * 0.55);
    await expect
      .poll(() => host.evaluate(() => (window as unknown as { __LIVEDESK_DEBUG__: { executedInputs: () => number } }).__LIVEDESK_DEBUG__.executedInputs()), { timeout: 20_000 })
      .toBeGreaterThan(executedBefore + 2);

    // Host presses Esc: control ends immediately on the member.
    await host.keyboard.press('Escape');
    await expect(member.getByRole('button', { name: 'Request control' })).toBeVisible({ timeout: 20_000 });
    const executedAfterRevoke = await host.evaluate(() => (window as unknown as { __LIVEDESK_DEBUG__: { executedInputs: () => number } }).__LIVEDESK_DEBUG__.executedInputs());
    await member.mouse.move(memberVideoBox.x + memberVideoBox.width * 0.3, memberVideoBox.y + memberVideoBox.height * 0.3, { steps: 5 });
    await member.waitForTimeout(500);
    const executedLater = await host.evaluate(() => (window as unknown as { __LIVEDESK_DEBUG__: { executedInputs: () => number } }).__LIVEDESK_DEBUG__.executedInputs());
    expect(executedLater).toBe(executedAfterRevoke);

    // --- Stop sharing: the member's screen video goes away ---
    await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(member.getByTestId('screen-share-video')).toHaveCount(0, { timeout: 20_000 });
  });

  test('chat, hand raise and translated captions synchronize over the data plane', async ({ context }) => {
    const { host, member } = await openPair(context);

    // Chat: member -> host.
    await member.getByRole('button', { name: 'Chat' }).click();
    await member.getByPlaceholder('Type a message...').fill('Namaste from Rahul');
    await member.getByPlaceholder('Type a message...').press('Enter');
    await host.getByRole('button', { name: 'Chat' }).click();
    await expect(host.getByText('Namaste from Rahul')).toBeVisible({ timeout: 20_000 });

    // Hand raise: host -> member participant list.
    await host.getByRole('button', { name: 'Raise hand' }).click();
    await member.getByRole('button', { name: 'Participants' }).click();
    await expect(member.getByText('Raised hands (1)')).toBeVisible({ timeout: 20_000 });

    // Translation: member prefers Tamil; a Hindi segment from the host is translated (mock provider).
    await member.evaluate(() => {
      const dbg = (window as unknown as { __LIVEDESK_DEBUG__: { store: { getState: () => { setTranslation: (p: unknown) => void; toggleRightPanel: (p: string) => void } } } }).__LIVEDESK_DEBUG__;
      dbg.store.getState().setTranslation({ enabled: true, preferredLanguage: 'ta', audioMode: 'original' });
      dbg.store.getState().toggleRightPanel('ai');
    });
    await host.evaluate(() => {
      const dbg = (window as unknown as { __LIVEDESK_DEBUG__: { bus: { publish: (t: string, p: unknown) => void } } }).__LIVEDESK_DEBUG__;
      dbg.bus.publish('stt', {
        kind: 'segment',
        segId: 'seg-e2e-1',
        speakerId: 'sess-host',
        speakerName: 'Host Vikas',
        text: 'kal meeting kitne baje hai',
        isFinal: true,
        confidence: 0.92,
        sourceLanguage: 'hi',
        at: Date.now(),
      });
    });
    await expect(member.getByText('[Tamil] kal meeting kitne baje hai')).toBeVisible({ timeout: 20_000 });
    await expect(member.getByTestId('translation-indicator')).toContainText('Live Translation');
  });
});
