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
        // same-origin: reject an explicit cross-site marker, AND reject a mismatched Origin (closes
        // the hole where Sec-Fetch-Site is simply omitted but a foreign Origin is supplied). A
        // legitimate same-origin browser fetch sends both matching; non-browser localhost tooling
        // sends neither, which is fine for a dev-only endpoint.
        if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return fail(403, "cross-origin blocked");
        const origin = req.headers["origin"];
        if (origin && req.headers.host && new URL(origin).host !== req.headers.host) return fail(403, "cross-origin blocked");
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
