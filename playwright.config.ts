import { createLovableConfig } from "lovable-agent-playwright-config/config";
import { devices } from "@playwright/test";

export default createLovableConfig({
  // Run centering regression against all three engines
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox",  use: { ...devices["Desktop Firefox"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"]  } },
  ],
});
