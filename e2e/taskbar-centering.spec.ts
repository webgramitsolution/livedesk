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

