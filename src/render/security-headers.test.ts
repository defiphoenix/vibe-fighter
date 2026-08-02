import { describe, it, expect } from "vitest";
import vercel from "../../vercel.json";

// vercel.json is the ONE source for the deployed security headers — vite.config.ts reads this same file
// and mirrors it onto `preview.headers`, which is the only place the production CSP is testable against
// the real built bundle. That single-sourcing is what stops preview and production drifting; this file
// is what stops the SET itself silently shrinking.
//
// These assertions are cheap and they are not decoration: a header is a one-line deletion away at all
// times, and nothing else in the repo would go red.

const headers = Object.fromEntries(
  vercel.headers[0].headers.map((h) => [h.key, h.value]),
) as Record<string, string>;

describe("deployed security headers", () => {
  it("applies to every route", () => {
    expect(vercel.headers[0].source).toBe("/(.*)");
  });

  it("keeps the full set — losing one is a silent downgrade", () => {
    expect(Object.keys(headers).sort()).toEqual([
      "Access-Control-Allow-Origin",
      "Content-Security-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
  });

  it("pins CORS to this site's own origin rather than Vercel's `*` default", () => {
    // Vercel serves `Access-Control-Allow-Origin: *` on static assets unless overridden. Nothing here is
    // credentialed, so the wildcard was not a data-theft risk — it just let any origin reuse the bundle
    // and the whole sprite/audio set on this account's bandwidth.
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://vibe-fighter-dusky.vercel.app");
  });

  it("denies the device APIs this game never uses", () => {
    const p = headers["Permissions-Policy"];
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb", "midi"]) {
      expect(p, `${feature} should be denied`).toContain(`${feature}=()`);
    }
  });

  it("does NOT deny fullscreen — the touch flow requests it", () => {
    // The highest-risk line in the whole header change. An omitted directive keeps its default (`self`),
    // which is what FlowScene's tap-to-start `requestFullscreen()` needs; `fullscreen=()` would refuse it
    // and strand a phone with a URL bar eating ~15% of a screen this game has no spare pixels on.
    // Assert it is a string first: without this, a DELETED header fails here with an unreadable
    // "invalid arguments" type error instead of saying what actually went wrong.
    expect(typeof headers["Permissions-Policy"], "Permissions-Policy is missing entirely").toBe("string");
    expect(headers["Permissions-Policy"]).not.toContain("fullscreen");
  });

  it("keeps `style-src 'unsafe-inline'` — Phaser's canvas centring depends on it", () => {
    // Not an oversight to be tidied up later. ScaleManager.updateCenter writes marginLeft/marginTop as
    // style ATTRIBUTES, which CSP3 governs through style-src unless style-src-attr is split out; dropping
    // it moves the canvas off-centre for no gain, because this app renders no user content as HTML.
    expect(headers["Content-Security-Policy"]).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("keeps the CSP locked down by default", () => {
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // No 'unsafe-eval', no 'unsafe-inline' for SCRIPT — the bundle is one self-hosted module.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
