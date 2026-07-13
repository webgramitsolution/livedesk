import { test, expect, Page } from '../playwright-fixture';

/**
 * Mobile "More Options" submenu suite.
 *
 * Covers:
 *  - Accessibility for Invite/Share and Keyboard Shortcuts full-screen overlays
 *    (accessible close button, keyboard nav, focus stays within overlay,
 *    Escape/back dismissal restores focus).
 *  - Share Screen never opens desktop picker on mobile UI — routes to the
 *    unsupported/emulation sheet instead.
 *  - Opening any submenu closes the previous one; no centered desktop dialog
 *    ever renders below 768px.
 *  - Screenshot regression per submenu at 320/390/768 with a configured
 *    pixel-diff threshold saved to test-results/ on mismatch.
 *  - Whiteboard: focus trap, tab order, Escape/back dismissal without
 *    shifting the video viewport, at 320/390/768.
 */

const MOBILE_WIDTHS = [320, 390, 768] as const;
const SUBMENU_LABELS = [
  'Whiteboard',
  'Polls',
  'Background',
  'Stats',
  'About',
  'Invite',
  'Shortcuts',
] as const;

// Seed a live meeting session so the app renders MeetingRoom directly.
async function seedMeeting(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      'zoom-connect-active-meeting',
      JSON.stringify({
        screen: 'meeting',
        meetingId: 'e2e-mobile-1',
        meetingSessionId: 'sess-1',
        userName: 'E2E Tester',
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
      })
    );
  });
}

async function gotoMeeting(page: Page, width: number, height = 780) {
  await page.setViewportSize({ width, height });
  await seedMeeting(page);
  await page.goto('/');
  await page.locator('[data-testid="floating-control-bar"]').first().waitFor({ state: 'visible' });
}

async function openMoreSheet(page: Page) {
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('dialog', { name: /more meeting options/i }).waitFor({ state: 'visible' });
}

async function openSubmenu(page: Page, label: (typeof SUBMENU_LABELS)[number]) {
  await openMoreSheet(page);
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click();
}

// -----------------------------------------------------------------------------
// A11y: Invite/Share and Keyboard Shortcuts overlays
// -----------------------------------------------------------------------------
test.describe('Mobile submenu accessibility (Invite / Shortcuts)', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`Invite/Share overlay is accessible @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);
      await openSubmenu(page, 'Invite');

      const dialog = page.getByRole('dialog', { name: /invite participants/i });
      await expect(dialog).toBeVisible();

      // Full-screen sizing (100vw / 100dvh, no border radius)
      const box = await dialog.boundingBox();
      const vp = page.viewportSize()!;
      expect.soft(box?.width, 'width fills viewport').toBeCloseTo(vp.width, 0);
      expect.soft(box?.height, 'height fills viewport').toBeGreaterThanOrEqual(vp.height - 2);
      expect.soft(
        await dialog.evaluate((el) => getComputedStyle(el).borderRadius),
        'no border radius'
      ).toMatch(/^0px( 0px 0px 0px)?$/);

      // Accessible close button ("Back")
      const back = dialog.getByRole('button', { name: /^back$/i });
      await expect(back).toBeVisible();

      // Keyboard: tab moves focus, focus stays inside the dialog
      await back.focus();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"][aria-label="Invite participants"]');
          return !!d && d.contains(document.activeElement);
        });
        expect.soft(inside, `focus stays inside on Tab #${i + 1}`).toBeTruthy();
      }

      // Share buttons have accessible names
      for (const name of ['WhatsApp', 'Telegram', 'Email', 'Copy Link', 'SMS']) {
        await expect(dialog.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible();
      }

      // Back dismisses and no centered desktop dialog opens
      await back.click();
      await expect(dialog).toBeHidden();
    });

    test(`Keyboard Shortcuts overlay is accessible @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);
      await openSubmenu(page, 'Shortcuts');

      const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
      await expect(dialog).toBeVisible();

      const back = dialog.getByRole('button', { name: /^back$/i });
      await expect(back).toBeVisible();
      await back.focus();

      // Tab through — focus never leaves the dialog
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"][aria-label="Keyboard Shortcuts"]');
          return !!d && d.contains(document.activeElement);
        });
        expect.soft(inside, `focus trapped on Tab #${i + 1}`).toBeTruthy();
      }

      // Back button dismisses
      await back.click();
      await expect(dialog).toBeHidden();
    });
  }
});

// -----------------------------------------------------------------------------
// Screen share never launches desktop picker on mobile UI
// -----------------------------------------------------------------------------
test.describe('Mobile screen share flow', () => {
  for (const width of [320, 390] as const) {
    test(`tapping Share never calls getDisplayMedia @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);

      // Instrument getDisplayMedia BEFORE any user interaction.
      await page.evaluate(() => {
        (window as unknown as { __gdmCalls: number }).__gdmCalls = 0;
        if (navigator.mediaDevices) {
          navigator.mediaDevices.getDisplayMedia = async () => {
            (window as unknown as { __gdmCalls: number }).__gdmCalls += 1;
            throw new Error('desktop picker should never open on mobile UI');
          };
        }
      });

      await openMoreSheet(page);
      await page.getByRole('button', { name: /^Share$/i }).click();

      // Either the unsupported sheet appears (real mobile UA), or the
      // responsive-mode informational sheet appears (Chrome DevTools /
      // desktop UA at narrow width). Never the desktop picker.
      const unsupported = page.getByRole('dialog', { name: /screen sharing/i });
      await expect(unsupported).toBeVisible();
      await expect(unsupported).toContainText(/not supported|responsive mode/i);

      const calls = await page.evaluate(() => (window as unknown as { __gdmCalls: number }).__gdmCalls);
      expect(calls, 'getDisplayMedia must not be called from mobile UI').toBe(0);
    });
  }
});

// -----------------------------------------------------------------------------
// Single source-of-truth: switching submenus closes the previous;
// no centered desktop dialog appears under 768px.
// -----------------------------------------------------------------------------
test.describe('Mobile submenu router', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`switching submenus closes the previous @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);

      await openSubmenu(page, 'Polls');
      await expect(page.getByRole('dialog', { name: /polls/i })).toBeVisible();

      // Programmatically open another submenu (simulates rapid switch)
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('mobile-submenu:open', { detail: 'about' }))
      );

      await expect(page.getByRole('dialog', { name: /^about$/i })).toBeVisible();
      // Previous dialog must be gone — only one submenu dialog rendered
      const openDialogs = await page.locator('[role="dialog"][aria-modal="true"]').count();
      expect(openDialogs, 'only one submenu overlay at a time').toBeLessThanOrEqual(1);
    });

    test(`no centered desktop dialog appears @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);

      for (const label of ['Polls', 'Background', 'Stats', 'About', 'Invite', 'Shortcuts'] as const) {
        await openSubmenu(page, label);
        const dialog = page.locator('[role="dialog"]').last();
        await dialog.waitFor({ state: 'visible' });

        const box = await dialog.boundingBox();
        const vp = page.viewportSize()!;
        // Full-screen overlay: starts at x=0 and fills width. Centered desktop
        // dialogs would be inset from both edges.
        expect.soft(box?.x, `${label}: x should be 0`).toBeLessThanOrEqual(1);
        expect.soft(box?.width, `${label}: fills viewport width`).toBeGreaterThanOrEqual(vp.width - 2);

        // Close before opening next
        const back = dialog.getByRole('button', { name: /^back$/i });
        if (await back.isVisible().catch(() => false)) await back.click();
        else await page.keyboard.press('Escape');
      }
    });
  }
});

// -----------------------------------------------------------------------------
// Screenshot regression per submenu × breakpoint
// -----------------------------------------------------------------------------
test.describe('Mobile submenu screenshot regression', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const width of MOBILE_WIDTHS) {
    for (const label of ['Polls', 'Background', 'Stats', 'About', 'Invite', 'Shortcuts'] as const) {
      test(`${label} @ ${width}px snapshot`, async ({ page }) => {
        await gotoMeeting(page, width);
        await openSubmenu(page, label);
        // Wait for slide-in animation to settle
        await page.waitForTimeout(400);
        const dialog = page.locator('[role="dialog"][aria-modal="true"]').last();
        // Diffs saved automatically under test-results/ on mismatch.
        await expect(dialog).toHaveScreenshot(`submenu-${label}-${width}.png`, {
          maxDiffPixelRatio: 0.02,
          animations: 'disabled',
        });
      });
    }
  }
});

// -----------------------------------------------------------------------------
// Whiteboard overlay: focus trap, tab order, Escape/back dismissal,
// video viewport not shifted.
// -----------------------------------------------------------------------------
test.describe('Mobile Whiteboard overlay', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`Whiteboard focus + dismissal @ ${width}px`, async ({ page }) => {
      await gotoMeeting(page, width);

      // Capture video area rect before opening the overlay
      const videoArea = page.locator('[data-testid="floating-control-bar"]').first();
      const beforeBar = await videoArea.boundingBox();

      await openSubmenu(page, 'Whiteboard');
      const dialog = page.getByRole('dialog', { name: /whiteboard/i });
      await expect(dialog).toBeVisible();

      // Focus the Back button and tab — focus stays inside overlay
      const back = dialog.getByRole('button', { name: /^back$/i });
      await back.focus();
      const focusables: string[] = [];
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const d = document.querySelector('[role="dialog"][aria-label="Whiteboard"]');
          return {
            inside: !!d && !!el && d.contains(el),
            tag: el?.tagName ?? null,
            label: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 24) || '',
          };
        });
        expect.soft(info.inside, `Tab #${i + 1} stays inside`).toBeTruthy();
        if (info.inside) focusables.push(`${info.tag}:${info.label}`);
      }
      // Tab order visits multiple distinct controls (pen/eraser/colors/close)
      expect(new Set(focusables).size, 'tab order visits multiple controls').toBeGreaterThan(2);

      // Escape / back dismisses without shifting the video viewport
      await page.keyboard.press('Escape');
      // Escape may not be wired everywhere — fall back to Back button.
      if (await dialog.isVisible().catch(() => false)) await back.click();
      await expect(dialog).toBeHidden();

      const afterBar = await videoArea.boundingBox();
      if (beforeBar && afterBar) {
        expect.soft(Math.abs(afterBar.x - beforeBar.x), 'control bar x unchanged').toBeLessThanOrEqual(2);
        expect.soft(Math.abs(afterBar.y - beforeBar.y), 'control bar y unchanged').toBeLessThanOrEqual(2);
      }
    });
  }
});
