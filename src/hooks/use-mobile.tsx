import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const DESKTOP_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Returns overlay mode for meeting side panels.
 * - "mobile": <768px, full-screen bottom sheet
 * - "tablet": 768–1023px, 90% width right side sheet
 * - "desktop": >=1024px, inline right sidebar
 */
export function usePanelOverlayMode(): "mobile" | "tablet" | "desktop" {
  const [mode, setMode] = React.useState<"mobile" | "tablet" | "desktop">("desktop");

  React.useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      if (w < MOBILE_BREAKPOINT) setMode("mobile");
      else if (w < DESKTOP_BREAKPOINT) setMode("tablet");
      else setMode("desktop");
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return mode;
}
