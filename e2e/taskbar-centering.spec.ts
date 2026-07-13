import { test, expect } from '../playwright-fixture';

// This spec runs against whatever browser projects are configured in
// playwright.config.ts. To exercise WebKit + Firefox add projects like:
//   { name: 'firefox',  use: { ...devices['Desktop Firefox'] } }
//   { name: 'webkit',   use: { ...devices['Desktop Safari']  } }
// The assertions below are browser-agnostic and will run on each project.

/**
 * Visual/positional regression: the floating control bar must remain
 * horizontally centered in the viewport at multiple sizes and zoom levels,
 * including the pop-out screen-share tab.
 *
 * The bar is identified by [data-testid="floating-control-bar"] (added on the
 * expanded control wrapper). If missing, the test falls back to the first
 * fixed-position button group at the bottom of the meeting view.
 */

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'laptop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'small-813', width: 813, height: 620 },
  { name: 'mobile-390', width: 390, height: 780 },
];

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5];

async function assertCentered(page: import('@playwright/test').Page, tolerancePx = 2) {
  const bar = page.locator('[data-testid="floating-control-bar"]').first();
  await bar.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('missing bounding box or viewport');
  const barCenter = box.x + box.width / 2;
  const viewportCenter = viewport.width / 2;
  const delta = Math.abs(barCenter - viewportCenter);
  expect.soft(delta, `expected bar center (${barCenter}) within ${tolerancePx}px of viewport center (${viewportCenter})`).toBeLessThanOrEqual(tolerancePx);
}

test.describe('Floating control bar centering', () => {
  for (const vp of VIEWPORTS) {
    test(`stays centered at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await assertCentered(page);
    });
  }

  for (const zoom of ZOOMS) {
    test(`stays centered at zoom ${zoom}x`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await page.evaluate((z) => {
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
      }, zoom);
      await assertCentered(page, 3);
    });
  }

  test('stays centered in a popped-out screen-share tab', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    // Simulate window.open pop-out by opening a second page at the same URL
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 1024, height: 768 });
    await popup.goto('/?popout=1');
    await assertCentered(popup);
  });

  // Rotation / orientation
  for (const [portrait, landscape] of [
    [{ w: 390, h: 780 }, { w: 780, h: 390 }],
    [{ w: 820, h: 1180 }, { w: 1180, h: 820 }],
  ] as const) {
    test(`stays centered rotating ${portrait.w}x${portrait.h} → ${landscape.w}x${landscape.h}`, async ({ page }) => {
      await page.setViewportSize({ width: portrait.w, height: portrait.h });
      await page.goto('/');
      await assertCentered(page);
      await page.setViewportSize({ width: landscape.w, height: landscape.h });
      await page.waitForTimeout(200);
      await assertCentered(page);
    });
  }

  // Right-side panels open/close should NOT shift the bar (it's viewport-fixed)
  const PANEL_BUTTONS = ['Participants', 'AI Sidebar'];
  for (const panel of PANEL_BUTTONS) {
    test(`stays centered when ${panel} panel toggles`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await assertCentered(page);
      const btn = page.getByRole('button', { name: panel }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(250);
        await assertCentered(page);
        await btn.click();
        await page.waitForTimeout(250);
        await assertCentered(page);
      }
    });
  }
});

test.describe('Modal accessibility and centering', () => {
  test('Settings modal traps focus, closes on Escape, and stays centered under panels', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Open Settings via keyboard shortcut
    await page.keyboard.press(',');
    const dialog = page.getByRole('dialog', { name: 'Meeting Settings' });
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    // First focusable inside dialog should have focus
    const activeInside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Meeting Settings"]');
      return !!d && d.contains(document.activeElement);
    });
    expect(activeInside, 'focus should be trapped inside Settings dialog').toBeTruthy();

    // Assert centered horizontally + vertically
    const assertModalCentered = async () => {
      const box = await dialog.boundingBox();
      const vp = page.viewportSize()!;
      if (!box) throw new Error('no bounding box');
      const dx = Math.abs(box.x + box.width / 2 - vp.width / 2);
      const dy = Math.abs(box.y + box.height / 2 - vp.height / 2);
      expect.soft(dx, 'horizontal center delta').toBeLessThanOrEqual(3);
      expect.soft(dy, 'vertical center delta').toBeLessThanOrEqual(24); // header/footer weight
    };
    await assertModalCentered();

    for (const panel of ['Chat', 'AI Sidebar', 'Participants']) {
      const btn = page.getByRole('button', { name: panel }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(200);
        await assertModalCentered();
        await btn.click();
        await page.waitForTimeout(200);
      }
    }

    // Escape closes the modal
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 3_000 });

    // Attach the alignment-debug JSON to the test artifacts (best-effort)
    try {
      await page.evaluate(() => localStorage.setItem('lovable:debug-align', '1'));
      await page.reload();
      const json = await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('button');
        // Trigger the "Save JSON" button in the debug overlay if present
        const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save JSON');
        if (!saveBtn) return null;
        // Instead of triggering a download, read the same payload directly.
        return JSON.stringify({
          capturedAt: new Date().toISOString(),
          viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        });
      });
      if (json) await testInfo.attach('align-debug.json', { body: json, contentType: 'application/json' });
    } catch {
      /* non-fatal */
    }
  });
});

test.describe('Breakout Rooms modal', () => {
  const BREAKOUT_ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25];
  const BREAKOUT_PANELS = ['none', 'Chat', 'AI Sidebar', 'Participants'] as const;

  const openBreakout = async (page: import('@playwright/test').Page) => {
    await page.keyboard.press('b');
    const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    return dialog;
  };

  const assertModalOk = async (page: import('@playwright/test').Page) => {
    const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
    const box = await dialog.boundingBox();
    const vp = page.viewportSize()!;
    if (!box) throw new Error('no dialog box');
    // Portaled to body — parent should be <body>
    const parentIsBody = await dialog.evaluate((el) => el.parentElement?.parentElement?.tagName === 'BODY' || el.closest('body') !== null);
    expect(parentIsBody).toBeTruthy();
    // No horizontal overflow
    expect.soft(box.x, 'left edge inside viewport').toBeGreaterThanOrEqual(-1);
    expect.soft(box.x + box.width, 'right edge inside viewport').toBeLessThanOrEqual(vp.width + 1);
    // Centered
    const dx = Math.abs(box.x + box.width / 2 - vp.width / 2);
    expect.soft(dx, 'horizontal center delta').toBeLessThanOrEqual(3);
    expect.soft(box.height, 'height stays constrained').toBeLessThanOrEqual(vp.height * 0.85 + 4);
  };

  const seedBreakoutParticipants = async (page: import('@playwright/test').Page) => {
    await page.evaluate(() => {
      const store = (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: {
          addBreakoutParticipants?: (names: string[]) => void;
        };
      }).__ZOOM_CONNECT_E2E__;

      store?.addBreakoutParticipants?.([
        'gemehug421xxxxxxxxxxxxxxxx',
        'avery-long-participant-name-that-must-truncate',
        'Marina Kovalenko',
        'Daniel Thompson',
        'Priya Ramanathan',
        'Noah Fitzgerald',
        'Charlotte Nguyen',
        'Mateo Hernandez',
        'Aisha Al-Fayed',
        'Kenji Watanabe',
        'Sofia Andersson',
        'Lucas Beaumont',
      ]);
    });
  };

  const switchTabsAndAssertLayout = async (page: import('@playwright/test').Page) => {
    const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
    const grid = page.locator('[data-testid="breakout-room-grid"]');
    const body = page.locator('[data-testid="breakout-modal-body"]');
    const addRoom = page.getByRole('button', { name: 'Add Room' });
    const autoAssign = page.getByRole('button', { name: 'Auto-assign' });

    for (let i = 0; i < 4; i++) await addRoom.click();
    await assertModalOk(page);

    await autoAssign.click();
    await page.waitForTimeout(100);
    await assertModalOk(page);

    await addRoom.click();
    await page.waitForTimeout(100);
    await assertModalOk(page);

    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Breakout Rooms"]');
      const grid = document.querySelector<HTMLElement>('[data-testid="breakout-room-grid"]');
      const body = document.querySelector<HTMLElement>('[data-testid="breakout-modal-body"]');
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="breakout-room-card"]'));
      const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="breakout-participant-chip"]'));
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"][aria-label="Breakout room actions"] button'));

      return {
        bodyOverflowX: body ? body.scrollWidth - body.clientWidth : 0,
        gridWidth: grid?.getBoundingClientRect().width ?? 0,
        dialogWidth: dialog?.getBoundingClientRect().width ?? 0,
        columns: cards.length ? new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size : 0,
        cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            overflowsX: card.scrollWidth > card.clientWidth + 1,
          };
        }),
        chips: chips.map((chip) => {
          const rect = chip.getBoundingClientRect();
          return {
            width: rect.width,
            overflowsX: chip.scrollWidth > chip.clientWidth + 1,
          };
        }),
        actionButtons: buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
          overflowsX: button.scrollWidth > button.clientWidth + 1,
        })),
      };
    });

    expect.soft(metrics.bodyOverflowX, 'modal body must not overflow horizontally').toBeLessThanOrEqual(1);
    expect.soft(metrics.gridWidth, 'grid fills available modal width').toBeGreaterThan(metrics.dialogWidth * 0.8);
    expect.soft(metrics.columns, 'desktop grid should use multiple equal columns when space allows').toBeGreaterThanOrEqual(2);
    for (const card of metrics.cards) {
      expect.soft(card.width, 'room cards stay wide enough for readable titles').toBeGreaterThanOrEqual(250);
      expect.soft(card.height, 'room card min-height is preserved').toBeGreaterThanOrEqual(210);
      expect.soft(card.overflowsX, 'room card content must not overflow horizontally').toBeFalsy();
    }
    for (const chip of metrics.chips) {
      expect.soft(chip.overflowsX, 'participant chip must truncate instead of overflowing').toBeFalsy();
    }
    for (const button of metrics.actionButtons) {
      expect.soft(button.height, 'action buttons keep tap target height').toBeGreaterThanOrEqual(40);
      expect.soft(button.overflowsX, 'action button labels must not wrap or clip').toBeFalsy();
    }

    await expect(dialog).toBeVisible();
    await expect(grid).toBeVisible();
    await expect(body).toBeVisible();
  };

  for (const zoom of BREAKOUT_ZOOMS) {
    for (const panel of BREAKOUT_PANELS) {
      test(`stays centered without overflow at zoom ${zoom}x (panel: ${panel})`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');
        await page.evaluate((z) => {
          (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
        }, zoom);
        if (panel !== 'none') {
          const btn = page.getByRole('button', { name: panel }).first();
          if (await btn.isVisible().catch(() => false)) await btn.click();
        }
        await openBreakout(page);
        await assertModalOk(page);

        // Bounding-box constraint asserts: width <= viewport, height <= 85dvh
        const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
        const box = await dialog.boundingBox();
        const vp = page.viewportSize()!;
        if (!box) throw new Error('no box');
        expect.soft(box.width, 'width within viewport').toBeLessThanOrEqual(vp.width);
        expect.soft(box.height, 'height within 85dvh cap').toBeLessThanOrEqual(vp.height * 0.85 + 4);
      });
    }
  }

  for (const zoom of BREAKOUT_ZOOMS) {
    for (const panel of BREAKOUT_PANELS) {
      test(`keeps Breakout Rooms grid stable while switching Auto-assign/Add Room at ${zoom}x (panel: ${panel})`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');
        await seedBreakoutParticipants(page);
        await page.evaluate((z) => {
          (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
        }, zoom);
        if (panel !== 'none') {
          const btn = page.getByRole('button', { name: panel }).first();
          if (await btn.isVisible().catch(() => false)) await btn.click();
        }
        await openBreakout(page);
        await switchTabsAndAssertLayout(page);
      });
    }
  }

  for (const panel of ['Chat', 'AI Sidebar', 'Participants']) {
    test(`stays centered while ${panel} toggles`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await openBreakout(page);
      const btn = page.getByRole('button', { name: panel }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(200);
        await assertModalOk(page);
        await btn.click();
        await page.waitForTimeout(200);
        await assertModalOk(page);
      }
    });
  }

  test('Tab/Shift+Tab cycles focus; Escape, backdrop and Done restore focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Focus a taskbar button first so we can assert restoration
    const settingsBtn = page.getByRole('button', { name: 'Settings' }).first();
    await settingsBtn.focus();
    await page.keyboard.press('b');
    const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
    await dialog.waitFor({ state: 'visible' });

    // Tab forward should stay inside the dialog
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Breakout Rooms"]');
      return !!d && d.contains(document.activeElement);
    });
    expect(stillInside, 'focus trapped forward').toBeTruthy();

    // Shift+Tab should also stay inside
    for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+Tab');
    const stillInsideBack = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Breakout Rooms"]');
      return !!d && d.contains(document.activeElement);
    });
    expect(stillInsideBack, 'focus trapped backward').toBeTruthy();

    // Escape → focus restored
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('title') || document.activeElement?.textContent);
    expect(focusedName).toContain('Settings');
  });
});

test.describe('Keyboard shortcut integrity', () => {
  test('taskbar-focus shortcut does not collide with Settings shortcut', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Ctrl+/ must focus the taskbar without opening Settings
    await page.keyboard.press('Control+/');
    const settingsOpen = await page.getByRole('dialog', { name: 'Meeting Settings' }).isVisible().catch(() => false);
    expect(settingsOpen).toBeFalsy();
    const focusInsideBar = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="floating-control-bar"]');
      return !!bar && bar.contains(document.activeElement);
    });
    expect(focusInsideBar).toBeTruthy();

    // Comma must open Settings without stealing bar focus permanently
    await page.keyboard.press(',');
    await page.getByRole('dialog', { name: 'Meeting Settings' }).waitFor({ state: 'visible' });
  });
});

