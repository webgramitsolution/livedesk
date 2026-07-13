import { createLovableConfig } from "lovable-agent-playwright-config/config";
import { devices } from "@playwright/test";

export default createLovableConfig({
  // Capture rich failure artifacts for CI debugging
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Run centering regression against all three engines
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"]  } },
    // Additional device emulations for Breakout Rooms visual/interaction runs
    { name: "iphone-13",     use: { ...devices["iPhone 13"] } },
    { name: "desktop-1280",  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920",  use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    // Tablet + mobile, portrait & landscape, for Breakout / screen-share suites
    { name: "ipad-portrait",   use: { ...devices["iPad (gen 7)"] } },
    { name: "ipad-landscape",  use: { ...devices["iPad (gen 7) landscape"] } },
    { name: "pixel-5",         use: { ...devices["Pixel 5"] } },
    { name: "pixel-5-landscape", use: { ...devices["Pixel 5 landscape"] } },
    { name: "iphone-13-landscape", use: { ...devices["iPhone 13 landscape"] } },
  ],
});
