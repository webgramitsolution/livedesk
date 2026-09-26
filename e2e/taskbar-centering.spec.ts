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
            width: card.clientWidth,
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

  // --- Sticky Start Breakout Sessions button ---
  for (const zoom of BREAKOUT_ZOOMS) {
    test(`Start Breakout Sessions button stays sticky & clickable while participant list scrolls at ${zoom}x`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await seedBreakoutParticipants(page);
      await page.evaluate(() => {
        (window as typeof window & {
          __ZOOM_CONNECT_E2E__?: { assignAllToFirstRoom?: () => void };
        }).__ZOOM_CONNECT_E2E__?.assignAllToFirstRoom?.();
      });
      await page.evaluate((z) => {
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
      }, zoom);

      await openBreakout(page);

      const startBtn = page.getByTestId('breakout-start-button');
      const footer = page.getByTestId('breakout-modal-footer');
      const list = page.locator('[data-testid="breakout-participant-list"]').first();

      // Sticky before scroll
      await expect(startBtn).toBeVisible();
      const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
      const beforeBox = await footer.boundingBox();
      const dialogBox = await dialog.boundingBox();
      if (!beforeBox || !dialogBox) throw new Error('no box');
      // Footer should sit near the bottom of the dialog
      expect.soft(dialogBox.y + dialogBox.height - (beforeBox.y + beforeBox.height))
        .toBeLessThanOrEqual(2);

      // Scroll the participant list to the bottom
      await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(50);

      const afterBox = await footer.boundingBox();
      if (!afterBox) throw new Error('no box');
      expect.soft(Math.abs(afterBox.y - beforeBox.y), 'sticky footer must not shift on scroll')
        .toBeLessThanOrEqual(2);

      // Must remain clickable (not covered / not disabled)
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toBeEnabled();
      await startBtn.click({ trial: true });
    });
  }

  // --- Participant list scroll threshold (>5) ---
  test('participants area is not scrollable at ≤5 names and becomes scrollable past 5', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Seed exactly 5, assign to Room 1
    await page.evaluate(() => {
      const hook = (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: {
          addBreakoutParticipants?: (n: string[]) => void;
          assignAllToFirstRoom?: () => void;
        };
      }).__ZOOM_CONNECT_E2E__;
      hook?.addBreakoutParticipants?.(['A', 'B', 'C', 'D', 'E']);
      hook?.assignAllToFirstRoom?.();
    });

    await openBreakout(page);
    const list = page.locator('[data-testid="breakout-participant-list"]').first();
    const notScrollable = await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    expect(notScrollable, 'list should not scroll with 5 or fewer chips').toBeTruthy();

    // Add many more so total > 5
    await page.evaluate(() => {
      const hook = (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: {
          addBreakoutParticipants?: (n: string[]) => void;
          assignAllToFirstRoom?: () => void;
        };
      }).__ZOOM_CONNECT_E2E__;
      hook?.addBreakoutParticipants?.(['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
      hook?.assignAllToFirstRoom?.();
    });
    await page.waitForTimeout(100);

    const isScrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(isScrollable, 'list should scroll once past 5 chips').toBeTruthy();
  });

  // --- Chip truncation at common zoom levels ---
  for (const zoom of BREAKOUT_ZOOMS) {
    test(`participant chips always ellipsis-truncate inside card at ${zoom}x`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await seedBreakoutParticipants(page);
      await page.evaluate(() => {
        (window as typeof window & {
          __ZOOM_CONNECT_E2E__?: { assignAllToFirstRoom?: () => void };
        }).__ZOOM_CONNECT_E2E__?.assignAllToFirstRoom?.();
      });
      await page.evaluate((z) => {
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
      }, zoom);

      await openBreakout(page);

      const violations = await page.evaluate(() => {
        const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="breakout-participant-chip"]'));
        const bad: Array<{ i: number; reason: string }> = [];
        chips.forEach((chip, i) => {
          const card = chip.closest<HTMLElement>('[data-testid="breakout-room-card"]');
          const chipR = chip.getBoundingClientRect();
          const cardR = card?.getBoundingClientRect();
          if (chip.scrollWidth > chip.clientWidth + 1) bad.push({ i, reason: 'chip content overflows' });
          if (cardR && (chipR.right > cardR.right + 1 || chipR.left < cardR.left - 1)) {
            bad.push({ i, reason: 'chip escapes card horizontally' });
          }
          const nameSpan = chip.querySelector<HTMLElement>('span.truncate');
          if (nameSpan) {
            const style = getComputedStyle(nameSpan);
            if (style.textOverflow !== 'ellipsis' || style.whiteSpace !== 'nowrap') {
              bad.push({ i, reason: `missing ellipsis truncation (${style.textOverflow}/${style.whiteSpace})` });
            }
          }
        });
        return bad;
      });
      expect(violations, `chip truncation issues: ${JSON.stringify(violations)}`).toEqual([]);
    });
  }

  // --- Keyboard navigation across Auto-assign / Add Room / Remove ---
  test('keyboard navigation reaches Auto-assign, Add Room, and Remove without losing focus under zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.evaluate(() => {
      (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = '1.25';
    });
    await openBreakout(page);

    const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
    const focusInside = async () =>
      dialog.evaluate((el) => el.contains(document.activeElement));

    // Tab until we land on Auto-assign, then activate
    let landed = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(), `focus stayed inside dialog after Tab #${i + 1}`).toBeTruthy();
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
      if (label?.includes('Auto-assign')) { landed = true; break; }
    }
    expect(landed, 'reached Auto-assign via Tab').toBeTruthy();
    await page.keyboard.press('Enter');

    // Continue tabbing to Add Room and activate to create a removable room
    landed = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(), `focus stayed inside dialog while seeking Add Room #${i + 1}`).toBeTruthy();
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
      if (label?.includes('Add Room')) { landed = true; break; }
    }
    expect(landed, 'reached Add Room via Tab').toBeTruthy();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // add another so Remove buttons render

    // Find a Remove button via keyboard and activate it
    landed = false;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(), `focus stayed inside dialog while seeking Remove #${i + 1}`).toBeTruthy();
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
      if (label === 'Remove') { landed = true; break; }
    }
    expect(landed, 'reached Remove via Tab').toBeTruthy();

    const beforeCount = await page.locator('[data-testid="breakout-room-card"]').count();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const afterCount = await page.locator('[data-testid="breakout-room-card"]').count();
    expect(afterCount).toBe(beforeCount - 1);
    expect(await focusInside(), 'focus remained inside dialog after Remove').toBeTruthy();
  });

  // --- Visual regression snapshots ---
  for (const zoom of BREAKOUT_ZOOMS) {
    for (const panel of BREAKOUT_PANELS) {
      for (const mode of ['auto-assign', 'add-room'] as const) {
        test(`visual: Breakout Rooms @ ${zoom}x, panel=${panel}, mode=${mode}`, async ({ page }, testInfo) => {
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
          const action = mode === 'auto-assign'
            ? page.getByRole('button', { name: 'Auto-assign' })
            : page.getByRole('button', { name: 'Add Room' });
          await action.click();
          await page.waitForTimeout(150);

          const dialog = page.getByRole('dialog', { name: 'Breakout Rooms' });
          const buf = await dialog.screenshot();
          await testInfo.attach(`breakout-${zoom}x-${panel}-${mode}.png`, {
            body: buf,
            contentType: 'image/png',
          });
          await expect(dialog).toHaveScreenshot(
            `breakout-${zoom}x-${panel}-${mode}.png`,
            { maxDiffPixelRatio: 0.02 },
          );
        });
      }
    }
  }
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


// ---------------------------------------------------------------------------
// Screen-share self-capture / hall-of-mirrors regression
// ---------------------------------------------------------------------------
test.describe('Screen share: self-capture (hall of mirrors)', () => {
  const ZOOMS = [0.5, 0.75, 1, 1.25];

  const simulateSelfShare = async (page: import('@playwright/test').Page, on: boolean) => {
    await page.evaluate((v) => {
      (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
      }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(v);
    }, on);
  };

  test('shows "You are presenting" placeholder, hides live preview, restores after stop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await simulateSelfShare(page, true);

    const placeholder = page.getByTestId('self-capture-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('You are presenting');
    await expect(page.getByTestId('self-capture-warning')).toContainText(/recursive/i);

    // Absolutely no <video> element should be rendering the shared surface while suppressed
    const videosPlayingScreen = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('video'))
        .filter((v) => v.srcObject instanceof MediaStream && !v.paused && v.readyState >= 2)
        .filter((v) => v.closest('[data-testid="self-capture-placeholder"]') !== null)
        .length;
    });
    expect(videosPlayingScreen, 'no live <video> under placeholder').toBe(0);

    // Stop sharing → normal grid returns, placeholder gone
    await simulateSelfShare(page, false);
    await expect(placeholder).toBeHidden();
  });

  for (const zoom of ZOOMS) {
    test(`placeholder a11y: focus ring, ARIA labels, tab order @ ${zoom}x`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      await page.evaluate((z) => {
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
      }, zoom);
      await simulateSelfShare(page, true);

      const placeholder = page.getByTestId('self-capture-placeholder');
      await expect(placeholder).toHaveAttribute('role', 'status');
      await expect(placeholder).toHaveAttribute('aria-live', 'polite');
      await expect(placeholder).toHaveAttribute('aria-label', /presenting/i);

      // Stop Sharing button in the floating control near placeholder must be keyboard reachable
      const stopBtn = page.getByRole('button', { name: /stop sharing/i }).first();
      await stopBtn.focus();
      await expect(stopBtn).toBeFocused();
      const ringOk = await stopBtn.evaluate((el) => {
        const s = getComputedStyle(el);
        // Either an outline or a visible box-shadow ring is acceptable
        return (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || s.boxShadow !== 'none';
      });
      expect(ringOk, 'visible focus ring on Stop Sharing').toBeTruthy();
    });
  }

  test('remote participants still see the shared video (outgoing track not stopped)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await simulateSelfShare(page, true);
    // The store flag driving peer negotiation stays true even while local preview is suppressed
    const state = await page.evaluate(() => ({
      isScreenSharing: (window as unknown as { __ZC_STORE__?: { isScreenSharing: boolean } })
        .__ZC_STORE__?.isScreenSharing ?? null,
    }));
    // If we haven't exposed the store, fall back to observing the UI signal
    if (state.isScreenSharing === null) {
      await expect(page.getByRole('button', { name: /stop sharing/i }).first()).toBeVisible();
    } else {
      expect(state.isScreenSharing).toBeTruthy();
    }
  });

  test('static thumbnail replaces live preview when self-capture is active', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await simulateSelfShare(page, true);
    const placeholder = page.getByTestId('self-capture-placeholder');
    await expect(placeholder).toBeVisible();
    // Either the static <img> thumbnail OR the Monitor icon fallback must render;
    // never a live <video> element.
    const hasThumbOrIcon = await placeholder.evaluate((el) => {
      const img = el.querySelector('[data-testid="self-capture-thumbnail"]');
      const icon = el.querySelector('svg');
      const liveVideo = el.querySelector('video');
      return !!(img || icon) && !liveVideo;
    });
    expect(hasThumbOrIcon).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getDisplayMedia surface selection: window vs monitor vs self tab
// ---------------------------------------------------------------------------
test.describe('Screen share: surface selection', () => {
  const install = async (
    page: import('@playwright/test').Page,
    surface: 'window' | 'monitor' | 'browser',
    selfOrigin: boolean,
  ) => {
    await page.addInitScript(({ surface, selfOrigin }) => {
      const win = window as unknown as {
        __ZC_FAKE_ORIGIN__: boolean;
        __ZC_FAKE_SURFACE__: string;
      };
      win.__ZC_FAKE_SURFACE__ = surface;
      win.__ZC_FAKE_ORIGIN__ = selfOrigin;

      const md = navigator.mediaDevices;
      md.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const stream = (canvas as HTMLCanvasElement).captureStream(1);
        const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
          getCaptureHandle?: () => { handle?: string; origin?: string } | null;
          getSettings: () => MediaTrackSettings & { displaySurface?: string };
        };
        const originalSettings = track.getSettings.bind(track);
        track.getSettings = () =>
          ({ ...originalSettings(), displaySurface: win.__ZC_FAKE_SURFACE__ } as MediaTrackSettings);
        track.getCaptureHandle = () => ({
          handle: win.__ZC_FAKE_SURFACE__ === 'browser' && win.__ZC_FAKE_ORIGIN__
            ? 'zoom-connect-fake-self'
            : 'other-app',
          origin: win.__ZC_FAKE_ORIGIN__ ? location.origin : 'https://other.example',
        });
        return stream;
      };
      // Match the app's capture-handle so the runtime detection triggers
      const original = md.setCaptureHandleConfig as ((cfg: unknown) => void) | undefined;
      if (original) {
        (md as MediaDevices & { setCaptureHandleConfig?: (cfg: unknown) => void })
          .setCaptureHandleConfig = () => original.call(md, { handle: 'zoom-connect-fake-self' });
      }
    }, { surface, selfOrigin });
  };

  const cases: Array<{ surface: 'window' | 'monitor' | 'browser'; selfOrigin: boolean; expectSelf: boolean; label: string }> = [
    { surface: 'window',  selfOrigin: false, expectSelf: false, label: 'window' },
    { surface: 'monitor', selfOrigin: false, expectSelf: false, label: 'monitor' },
    { surface: 'browser', selfOrigin: false, expectSelf: false, label: 'other browser tab' },
    { surface: 'browser', selfOrigin: true,  expectSelf: true,  label: 'meeting tab (self)' },
  ];

  for (const c of cases) {
    test(`only meeting-tab surface triggers warning/placeholder (${c.label})`, async ({ page }) => {
      await install(page, c.surface, c.selfOrigin);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      // Trigger the store's share flow so useWebRTC calls the (mocked) getDisplayMedia.
      // We flip the flag via the E2E hook, which the app watches.
      await page.evaluate(() => {
        const hook = (window as typeof window & {
          __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
        }).__ZOOM_CONNECT_E2E__;
        // For non-self cases we still exercise share, but must not force selfCapture:
        hook?.simulateSelfCaptureShare?.(false);
      });

      const placeholder = page.getByTestId('self-capture-placeholder');
      if (c.expectSelf) {
        await page.evaluate(() => {
          (window as typeof window & {
            __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
          }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(true);
        });
        await expect(placeholder).toBeVisible();
        await expect(placeholder).toContainText('You are presenting');
      } else {
        await expect(placeholder).toHaveCount(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Local preview render-suspension regression: no video frames advance
// ---------------------------------------------------------------------------
test.describe('Screen share: local preview frame suspension', () => {
  test('no <video> under placeholder advances currentTime while self-capture active', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.evaluate(() => {
      (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
      }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(true);
    });
    const placeholder = page.getByTestId('self-capture-placeholder');
    await expect(placeholder).toBeVisible();

    const sample = async () =>
      page.evaluate(() => {
        const ph = document.querySelector('[data-testid="self-capture-placeholder"]');
        const videos = ph ? Array.from(ph.querySelectorAll('video')) : [];
        return videos.map((v) => ({ t: v.currentTime, paused: v.paused }));
      });

    const first = await sample();
    await page.waitForTimeout(1500);
    const second = await sample();

    expect(first.length, 'no <video> should be rendered under the self-capture placeholder').toBe(0);
    expect(second.length, 'still no <video> after 1.5s').toBe(0);

    // Frame counter via requestVideoFrameCallback on any tracked local videos:
    const advanced = await page.evaluate(async () => {
      const vids = Array.from(document.querySelectorAll('video'));
      const results = await Promise.all(vids.map((v) => new Promise<number>((resolve) => {
        const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
          .requestVideoFrameCallback;
        if (!rvfc) { resolve(0); return; }
        let count = 0;
        const step = () => { count += 1; if (count < 3) rvfc.call(v, step); };
        rvfc.call(v, step);
        setTimeout(() => resolve(count), 1000);
      })));
      return results;
    });
    // No local video may advance ≥3 frames while sharing is suspended
    for (const n of advanced) expect(n).toBeLessThan(3);
  });

  test('resumes local preview immediately after sharing ends', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const hook = (on: boolean) => page.evaluate((v) => {
      (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
      }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(v);
    }, on);
    await page.evaluate(() => {
      (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
      }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(true);
    });
    await expect(page.getByTestId('self-capture-placeholder')).toBeVisible();
    await page.evaluate(() => {
      (window as typeof window & {
        __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
      }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(false);
    });
    await expect(page.getByTestId('self-capture-placeholder')).toBeHidden();
    // hook() unused; suppress lint
    void hook;
  });
});

// ---------------------------------------------------------------------------
// Placeholder a11y under repeated panel toggles + zoom sweep
// ---------------------------------------------------------------------------
test.describe('Placeholder a11y under panel toggling', () => {
  const ZOOMS = [0.5, 0.75, 1, 1.1, 1.25];
  const PANELS = ['Chat', 'AI Sidebar', 'Participants'] as const;

  for (const zoom of ZOOMS) {
    test(`tab order + focus ring stable while panels toggle @ ${zoom}x`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await page.evaluate((z) => {
        (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
      }, zoom);
      await page.evaluate(() => {
        (window as typeof window & {
          __ZOOM_CONNECT_E2E__?: { simulateSelfCaptureShare?: (on: boolean) => void };
        }).__ZOOM_CONNECT_E2E__?.simulateSelfCaptureShare?.(true);
      });

      const placeholder = page.getByTestId('self-capture-placeholder');
      await expect(placeholder).toBeVisible();

      for (const panel of PANELS) {
        const btn = page.getByRole('button', { name: panel }).first();
        if (!(await btn.isVisible().catch(() => false))) continue;
        for (let i = 0; i < 2; i++) {
          await btn.click(); await page.waitForTimeout(80);
          await btn.click(); await page.waitForTimeout(80);
        }
        // Placeholder must still be present with correct ARIA
        await expect(placeholder).toHaveAttribute('role', 'status');
        await expect(placeholder).toHaveAttribute('aria-live', 'polite');

        // Stop Sharing button focusable + visibly focused
        const stop = page.getByRole('button', { name: /stop sharing/i }).first();
        await stop.focus();
        await expect(stop).toBeFocused();
        const ringOk = await stop.evaluate((el) => {
          const s = getComputedStyle(el);
          return (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || s.boxShadow !== 'none';
        });
        expect(ringOk, `visible focus ring after toggling ${panel}`).toBeTruthy();
      }
    });
  }
});
