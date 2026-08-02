import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer, type ViteDevServer } from "vite";
import { gymSavePlugin, originVerdict, isTrustedOriginHost } from "./gym-save-plugin";
import viteConfig from "../vite.config";

// The dev-only `/__gym/save` write-back is the ONE place in this repo that makes an authorization
// decision, so it is the one place that needs its own tests. Everything else here is a pure sim or a
// render adapter.
//
// The thing being guarded is DNS rebinding: an attacker page whose domain re-resolves to 127.0.0.1
// produces a request whose Origin and Host MATCH each other, so the plugin's origin/Host
// self-consistency check passes. What actually blocks that today is Vite's own
// `hostValidationMiddleware`, which is registered BEFORE the configureServer hooks run and therefore
// sits in front of this endpoint. `isTrustedOriginHost` is defence in depth for the one case Vite
// stops covering: `server.allowedHosts: true`, which turns that shield off.
//
// Two layers, two kinds of test:
//   * `originVerdict` / `isTrustedOriginHost` — pure, so every branch is reachable without a server;
//   * four REAL Vite servers below — because a unit test of a predicate cannot see a predicate that
//     is never called, and cannot tell OUR 403 from Vite's. Both answer 403; only the body differs.

const servers: ViteDevServer[] = [];
afterAll(async () => { await Promise.all(servers.map((s) => s.close())); });

/** The registry bytes BEFORE any of this runs. This endpoint's whole job is overwriting that file, so
 *  "no case below wrote" has to be checked against the real bytes, not against a shape that a bad write
 *  could still satisfy. Read at module scope so no test can have run first. */
const REGISTRY_PATH = "public/configs/character-gym.json";
const REGISTRY_BEFORE = readFileSync(REGISTRY_PATH);

/**
 * A real dev server with the real plugin.
 *
 * `host: "127.0.0.1"` is explicit, not decorative: Vite's default host is `localhost`, which Node may
 * bind to `::1` only — the first version of this helper connected to 127.0.0.1 and got ECONNREFUSED from
 * a server that was up. Binding and connecting to the same literal removes the ambiguity. An IP literal
 * in `allowedHosts` also cannot affect the DNS-name cases these tests turn on.
 * The 5273 base keeps these off 5173, so a dev server left running does not collide.
 */
async function serverWith(allowedHosts?: true | string[]): Promise<{ port: number }> {
  const s = await createServer({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    plugins: [gymSavePlugin()],
    server: { host: "127.0.0.1", port: 5273, strictPort: false, ...(allowedHosts === undefined ? {} : { allowedHosts }) },
  });
  // Registered BEFORE listen(): if listen() throws for anything but an ordinary port collision, a server
  // recorded only on success would leak its watcher past afterAll and hold the run open.
  servers.push(s);
  await s.listen();
  return { port: (s.httpServer!.address() as { port: number }).port };
}

/** Raw node:http so Host and Origin can both be forged — fetch() forbids setting Host. */
function post(
  port: number,
  headers: Record<string, string>,
  body = "{}",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: "/__gym/save", method: "POST", headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let out = "";
        res.on("data", (c) => { out += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: out }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("isTrustedOriginHost", () => {
  it("accepts loopback and IP literals so LAN/VPN phone testing keeps working", () => {
    // The reason this is not a hardcoded 127.0.0.1/192.168.* allowlist: `vite --host` on a LAN, a VPN
    // address, or Tailscale all hand out addresses no RFC-1918 enumeration would cover, and rejecting
    // them would break the exact workflow the endpoint exists for.
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "192.168.1.42", "10.0.0.9", "100.101.102.103", "[::1]"]) {
      expect(isTrustedOriginHost(h, []), `${h} should be trusted`).toBe(true);
    }
  });

  it("rejects a DNS name that is not on the allowlist — the rebinding case", () => {
    expect(isTrustedOriginHost("evil.com", [])).toBe(false);
    expect(isTrustedOriginHost("evil.com", ["good.test"])).toBe(false);
  });

  it("honours the developer's own allowedHosts entries, including the leading-dot suffix form", () => {
    // Mirrors Vite's `isHostAllowedInternal` so this can never reject a host Vite itself accepts.
    expect(isTrustedOriginHost("devbox.test", ["devbox.test"])).toBe(true);
    expect(isTrustedOriginHost("a.corp.test", [".corp.test"])).toBe(true);
    expect(isTrustedOriginHost("corp.test", [".corp.test"])).toBe(true);
    expect(isTrustedOriginHost("notcorp.test", [".corp.test"])).toBe(false);
  });

  it("does NOT inherit `allowedHosts: true` — that is the one case this guard exists for", () => {
    // `true` disables Vite's host validation entirely. Copying it here would mean the guard evaporates
    // at exactly the moment it becomes the only thing left.
    expect(isTrustedOriginHost("evil.com", true)).toBe(false);
    expect(isTrustedOriginHost("localhost", true)).toBe(true);
  });
});

describe("originVerdict", () => {
  const ok = { origin: "http://localhost:5173", host: "localhost:5173" };

  it("accepts the real panel's request", () => {
    expect(originVerdict(ok, [])).toEqual({ ok: true });
  });

  it("rejects a cross-origin Sec-Fetch-Site, but ignores the header when absent", () => {
    expect(originVerdict({ ...ok, secFetchSite: "cross-site" }, []).ok).toBe(false);
    expect(originVerdict({ ...ok, secFetchSite: "same-origin" }, []).ok).toBe(true);
    // Fetch Metadata is only attached for potentially-trustworthy URLs, so a phone on a LAN IP sends
    // none at all. Requiring it would 403 the real panel.
    expect(originVerdict(ok, []).ok).toBe(true);
  });

  it("requires both Origin and Host — omitting them must not sail through", () => {
    expect(originVerdict({ host: "localhost:5173" }, []).ok).toBe(false);
    expect(originVerdict({ origin: "http://localhost:5173" }, []).ok).toBe(false);
    expect(originVerdict({}, []).ok).toBe(false);
  });

  it("treats a malformed or null Origin as a rejection, not a throw", () => {
    // `new URL("null")` throws; `Origin: null` is what a sandboxed iframe sends.
    expect(() => originVerdict({ origin: "null", host: "localhost:5173" }, [])).not.toThrow();
    expect(originVerdict({ origin: "null", host: "localhost:5173" }, []).ok).toBe(false);
    expect(originVerdict({ origin: "%%%", host: "localhost:5173" }, []).ok).toBe(false);
  });

  it("compares the full origin — scheme and port both count", () => {
    expect(originVerdict({ origin: "http://localhost:5173", host: "localhost:5174" }, []).ok).toBe(false);
    expect(originVerdict({ origin: "file://localhost:5173", host: "localhost:5173" }, []).ok).toBe(false);
  });

  it("rejects a rebound name even when Origin and Host agree", () => {
    // The whole point: these two MATCH, which is exactly what DNS rebinding produces.
    const v = originVerdict({ origin: "http://evil.com:5173", host: "evil.com:5173" }, true);
    expect(v).toEqual({ ok: false, code: 403, error: "cross-origin blocked" });
  });
});

describe("Vite's own DNS-rebinding shield (the assumption this plugin leans on)", () => {
  it("is not disabled by this repo's config", () => {
    // The real residual risk is not an attack — it is a future config change quietly removing the
    // shield that makes the attack unreachable. `allowedHosts: true` turns host validation off, and so
    // does an https dev server; a non-empty list widens it. Assert the whole value, not `!== true`:
    // `allowedHosts: ['.evil.com']` weakens it without ever equalling `true`.
    const server = (viteConfig as { server?: { allowedHosts?: unknown; https?: unknown } }).server;
    expect(server?.allowedHosts ?? [], "a non-empty allowedHosts widens Vite's DNS-rebinding shield").toEqual([]);
    expect(server?.https, "an https dev server skips Vite's host validation entirely").toBeFalsy();
  });
});

describe("/__gym/save against real Vite servers", () => {
  // Both layers answer 403, so every assertion below checks the BODY. A status-only assertion would
  // stay green with the guard deleted — Vite would answer for it.
  const OURS = "cross-origin blocked";

  it("case 1 — our origin check rejects a mismatched Origin", async () => {
    const { port } = await serverWith();
    const res = await post(port, { Host: `localhost:${port}`, Origin: "http://evil.com" });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe(OURS);
  });

  it("case 2 — Vite's shield rejects a rebound Host before we ever see it", async () => {
    const { port } = await serverWith();
    const res = await post(port, { Host: `evil.com:${port}`, Origin: `http://evil.com:${port}` });
    expect(res.status).toBe(403);
    // Vite's plain-text 403, NOT our JSON. This is the layer identification: if this ever starts
    // returning our body, Vite's ordering changed and this guard became the primary control.
    expect(res.body).toContain("Blocked request");
  });

  it("case 3 — a same-origin request reaches the body parser (so case 1 is not vacuous)", async () => {
    // Without this, cases 1 and 2 would both pass even if the endpoint 403'd unconditionally.
    // Content-Type matters: the JSON-only check runs BEFORE the body is read, so omitting it gives
    // 415 and proves nothing about the parser.
    const { port } = await serverWith();
    const res = await post(port, { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }, "{not json");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe("invalid JSON");
  });

  it("case 5 — a DUPLICATED Sec-Fetch-Site fails closed", async () => {
    // Reachable version of a fail-open the refactor could have introduced. Extracting the header into a
    // normaliser tempted `site[0]`, which would accept ["same-origin", "cross-site"] where the old
    // whole-value comparison rejected it.
    //
    // Be precise about what this covers, because the first two attempts were not. Node's parser JOINS
    // duplicate Sec-Fetch-Site headers into one comma-separated STRING, so the middleware receives
    // "same-origin, cross-site" and NEVER an array. That makes the `Array.isArray` branch unreachable
    // through real HTTP: mutating it to `site[0]` leaves this case — and every other — green, because the
    // branch is dead. It is kept only to satisfy `string | string[] | undefined`, and joins rather than
    // indexing so that if it ever DID run it would fail closed. It deliberately has no test; nothing can
    // turn one red. What this case genuinely guards is the reachable half — the Sec-Fetch-Site check
    // itself, which turns it red when removed.
    const { port } = await serverWith();
    const res = await post(port, {
      Host: `localhost:${port}`,
      Origin: `http://localhost:${port}`,
      "Sec-Fetch-Site": ["same-origin", "cross-site"] as unknown as string,
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe(OURS);
  });

  it("case 4 — with Vite's shield OFF, our guard is what stops the rebound origin", async () => {
    // The justification for isTrustedOriginHost existing. `allowedHosts: true` is the supported way to
    // disable host validation, and it is the only configuration in which this code path is reachable.
    const { port } = await serverWith(true);
    const res = await post(port, { Host: `evil.com:${port}`, Origin: `http://evil.com:${port}` });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe(OURS);
  });

  it("leaves the real registry byte-identical — every case above is a rejection", () => {
    // Live ammunition. The e2e suite has been burned once by a spec that mutated this file and failed to
    // restore it, and the damage was only visible four unrelated specs later. Byte equality, not a shape
    // check: a write that happened to produce valid-looking JSON would pass the shape and still be a bug.
    expect(readFileSync(REGISTRY_PATH).equals(REGISTRY_BEFORE)).toBe(true);
  });
});
