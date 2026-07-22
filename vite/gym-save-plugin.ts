import { writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { validateRegistry } from "../src/sim/validate-character";

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

export function gymSavePlugin(): Plugin {
  return {
    name: "gym-save",
    apply: "serve", // dev server only
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__gym/save", (req, res) => {
        const fail = (code: number, error: string) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error }));
        };
        if (req.method !== "POST") return fail(405, "POST only");
        // Same-origin enforcement. The ONE legitimate caller is the Gym/Playground panel in this page,
        // whose fetch() always carries an Origin — Fetch appends it to every non-GET/HEAD request. REQUIRING
        // Origin is what closes the hole: the previous version only rejected a *mismatched* one, so a client
        // that simply OMITTED both headers sailed through and rewrote the registry.
        //
        // Sec-Fetch-Site is checked only WHEN PRESENT, deliberately. Fetch Metadata is attached only for
        // potentially-trustworthy URLs, so a browser reaching this dev server over a LAN IP (`vite --host`,
        // e.g. testing on a phone) sends no Sec-Fetch-Site at all — making it mandatory would 403 the real
        // panel.
        //
        // Neither header AUTHENTICATES: curl forges both in one line. This closes CSRF and casual
        // non-browser writes, nothing more, which is why the finding is low severity. A per-server token
        // would be the real answer if this endpoint ever needed one — it doesn't, because `apply: "serve"`
        // keeps it out of every build.
        if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return fail(403, "cross-origin blocked");
        const origin = req.headers["origin"];
        const host = req.headers.host;
        if (!origin || !host) return fail(403, "cross-origin blocked");
        let originUrl: URL;
        // `new URL("null")` — and any malformed value — THROWS. Unhandled that is a 500 (or a dead
        // middleware) where a controlled 403 belongs; `Origin: null` is what a sandboxed iframe sends.
        try { originUrl = new URL(origin); } catch { return fail(403, "cross-origin blocked"); }
        // Compare the FULL origin, not just `.host` — scheme matters as well as host+port.
        if (originUrl.host !== host || (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")) {
          return fail(403, "cross-origin blocked");
        }
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
