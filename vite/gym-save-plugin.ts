import { writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { validateRegistry } from "../src/sim/validate-character.ts";

// DEV-ONLY write-back for the Character Gym. configureServer runs only under `vite` dev — never in
// `build` or `preview` — so this endpoint does not exist in a production bundle. The target path is
// fixed (no traversal), the body is size-limited + shape-validated by the SAME validator BootScene
// uses, and the write is atomic (temp file → rename) so a bad save can't corrupt the only JSON copy
// (this repo has no VCS safety net).
// Resolved from THIS FILE, not process.cwd(). cwd is whatever directory `vite` was launched from,
// so a dev server started from anywhere but the repo root wrote (or failed to write) to a path that
// does not exist — an ENOENT "no such file or directory" that reads, from the panel, like the
// fighter or the config went missing. The plugin's own location is the stable anchor.
const TARGET = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public/configs/character-gym.json");
const MAX_BYTES = 256 * 1024;

/** Dotted-quad or bracketed IPv6. `URL.hostname` keeps the brackets on a v6 literal. */
const IP_LITERAL = /^((\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:.]+\])$/;

/**
 * Vite's own `isHostAllowedInternal` policy, applied to the ORIGIN where Vite applies it to the HOST.
 *
 * Deferring to the developer's configured allowlist instead of hardcoding one is the whole design: any
 * fixed rule ("loopback and RFC-1918 only") would reject setups Vite itself accepts — `vite --host
 * devbox.local`, an mDNS name, a hosts entry, Tailscale MagicDNS — and would break phone testing, which
 * is the workflow this endpoint exists to serve.
 *
 * ONE deliberate divergence: `allowedHosts: true` is not honoured. That value turns Vite's host
 * validation OFF, which is the single configuration where this check stops being redundant and becomes
 * the only thing standing between a rebound DNS name and a registry write. Inheriting "allow all" there
 * would make the guard evaporate at exactly the moment it starts mattering.
 */
export function isTrustedOriginHost(hostname: string, allowedHosts: true | string[]): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (IP_LITERAL.test(hostname)) return true;
  if (allowedHosts === true) return false;
  return allowedHosts.some(
    (h) => h === hostname || (h[0] === "." && (h.slice(1) === hostname || hostname.endsWith(h))),
  );
}

/** What the endpoint checks about WHO is calling, as one pure decision. */
export interface OriginHeaders { secFetchSite?: string; origin?: string; host?: string }
export type OriginVerdict = { ok: true } | { ok: false; code: number; error: string };

/**
 * Exported so the test drives the REAL predicate rather than a copy of it — a second implementation in
 * a test file proves only that the copy agrees with itself.
 *
 * Sec-Fetch-Site is checked only WHEN PRESENT, deliberately. Fetch Metadata is attached only for
 * potentially-trustworthy URLs, so a browser reaching this dev server over a LAN IP (`vite --host`,
 * e.g. testing on a phone) sends no Sec-Fetch-Site at all — making it mandatory would 403 the real panel.
 *
 * REQUIRING Origin is what closes the original hole: an earlier version rejected only a *mismatched*
 * Origin, so a client that simply OMITTED both headers sailed through and rewrote the registry.
 *
 * None of this AUTHENTICATES — curl forges every one of these in a line. It closes CSRF, DNS rebinding
 * and casual non-browser writes, which is the whole threat model for an endpoint that `apply: "serve"`
 * keeps out of every build.
 */
export function originVerdict(h: OriginHeaders, allowedHosts: true | string[]): OriginVerdict {
  const blocked = { ok: false, code: 403, error: "cross-origin blocked" } as const;
  if (h.secFetchSite && h.secFetchSite !== "same-origin") return blocked;
  if (!h.origin || !h.host) return blocked;
  let originUrl: URL;
  // `new URL("null")` — and any malformed value — THROWS. Unhandled that is a 500 (or a dead
  // middleware) where a controlled 403 belongs; `Origin: null` is what a sandboxed iframe sends.
  try { originUrl = new URL(h.origin); } catch { return blocked; }
  // Compare the FULL origin, not just `.host` — scheme matters as well as host+port.
  if (originUrl.host !== h.host || (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")) {
    return blocked;
  }
  // Origin === Host is only SELF-CONSISTENCY, and DNS rebinding satisfies it: an attacker domain that
  // re-resolves to 127.0.0.1 sends a matching pair. The name is what gives it away.
  if (!isTrustedOriginHost(originUrl.hostname, allowedHosts)) return blocked;
  return { ok: true };
}

export function gymSavePlugin(): Plugin {
  return {
    name: "gym-save",
    apply: "serve", // dev server only
    configureServer(server: ViteDevServer) {
      // Read from the RESOLVED config, not the raw one: Vite folds `server.host`/`server.origin` into
      // the effective allowlist, and duplicating that derivation here is how the two would drift.
      const allowedHosts = server.config.server.allowedHosts;
      server.middlewares.use("/__gym/save", (req, res) => {
        const fail = (code: number, error: string) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== "POST") return fail(405, "POST only");
        // Same-origin enforcement, in one pure decision (see `originVerdict`). The ONE legitimate caller
        // is the Gym/Playground panel in this page. Note this middleware normally sits BEHIND Vite's own
        // `hostValidationMiddleware`, which is registered before the configureServer hooks run — so the
        // rebinding case is usually stopped upstream. `originVerdict` is what still holds when it isn't.
        // Node normally exposes this as a scalar (or comma-joined) string, so the array branch is
        // hypothetical — but taking `site[0]` would let ["same-origin", "cross-site"] through, where the
        // pre-refactor code compared the whole value and rejected it. Fail CLOSED on the shape you did
        // not expect: an array becomes a sentinel that cannot equal "same-origin".
        const site = req.headers["sec-fetch-site"];
        const verdict = originVerdict({
          secFetchSite: Array.isArray(site) ? site.join(",") : site,
          origin: req.headers["origin"],
          host: req.headers.host,
        }, allowedHosts);
        if (!verdict.ok) return fail(verdict.code, verdict.error);
        if (!String(req.headers["content-type"] ?? "").includes("application/json")) return fail(415, "JSON only");

        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) { fail(413, "payload too large"); req.destroy(); return; }
          chunks.push(c);
        });
        req.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { return fail(400, "invalid JSON"); }
          const errs = validateRegistry(parsed);
          if (errs.length) return fail(422, `validation failed: ${errs.slice(0, 5).join("; ")}`);
          if (!existsSync(dirname(TARGET))) return fail(500, `save target directory is missing: ${dirname(TARGET)}`);
          try {
            const tmp = TARGET + ".tmp";
            writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
            renameSync(tmp, TARGET); // atomic replace
          } catch (e) {
            return fail(500, `write failed: ${String(e)}`);
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        });
      });
    },
  };
}
