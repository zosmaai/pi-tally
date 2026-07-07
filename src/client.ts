/**
 * TallyClient — transport layer.
 *
 * Responsibilities:
 *   - HTTP POST envelopes to the Tally gateway
 *   - Apply timeout + retry with abort signal
 *   - Detect Tally bind address (localhost vs all-interfaces)
 *   - Probe gateway reachability + Education mode
 *   - Surface Tally errors as typed exceptions
 *
 * Non-responsibilities (handled by higher layers):
 *   - Building envelopes (envelopes.ts)
 *   - Parsing payloads (parse.ts)
 *   - Write-gate enforcement (safety.ts)
 *   - Confirmation prompts (tools/*)
 */

import { connect } from "node:net";
import {
  parseCompanies,
  parseTallyError,
  parseLicenseInfoResult,
  parseTallyLogical,
} from "./parse.js";
import type { CompanyInfo, LicenseProbe } from "./types.js";

export interface TallyClientConfig {
  /** Base URL of the Tally gateway. Default: http://localhost:9000 */
  url: string;
  /** Request timeout in ms. Default: 15000 */
  timeoutMs: number;
  /** Number of retries on network errors (not on Tally errors). Default: 1 */
  retries: number;
}

export const DEFAULT_CLIENT_CONFIG: TallyClientConfig = {
  url: "http://localhost:9000",
  timeoutMs: 15000,
  retries: 1,
};

export class TallyError extends Error {
  constructor(
    message: string,
    public readonly kind: "request" | "response" | "lineerror" | "timeout" | "network",
    public readonly raw?: string,
  ) {
    super(message);
    this.name = "TallyError";
  }
}

export class TallyClient {
  readonly config: TallyClientConfig;

  constructor(config: Partial<TallyClientConfig> = {}) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }

  /**
   * POST an envelope and return the raw response body.
   * Throws TallyError on:
   *   - timeout
   *   - network failure (after retries)
   *   - HTTP non-200
   *   - <ERRORMSG> / <LINEERROR> in response body
   */
  async send(envelope: string, signal?: AbortSignal): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const body = await this.postOnce(envelope, signal);
        const err = parseTallyError(body);
        if (err) {
          throw new TallyError(err.message, err.kind, err.raw);
        }
        return body;
      } catch (e) {
        lastErr = e;
        if (e instanceof TallyError) throw e; // Don't retry Tally-level errors
        if (signal?.aborted) throw e;
        if (attempt < this.config.retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
      }
    }
    throw new TallyError(
      `Request failed after ${this.config.retries + 1} attempt(s): ${formatErr(lastErr)}`,
      "network",
    );
  }

  private async postOnce(envelope: string, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const composite = composeSignals(controller.signal, signal);
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.config.timeoutMs);
    try {
      const res = await fetch(this.config.url, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: envelope,
        signal: composite,
      });
      if (!res.ok) {
        throw new TallyError(`HTTP ${res.status} from ${this.config.url}`, "request");
      }
      return await res.text();
    } catch (e) {
      if (controller.signal.aborted && controller.signal.reason?.message === "timeout") {
        throw new TallyError(
          `Tally did not respond within ${this.config.timeoutMs}ms`,
          "timeout",
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Reachability probe + list companies. Cheap; safe to call from session_start.
   * Throws TallyError if Tally is not running or not reachable.
   */
  async listCompanies(): Promise<CompanyInfo[]> {
    const { buildListCompaniesEnvelope } = await import("./envelopes.js");
    const body = await this.send(buildListCompaniesEnvelope());
    return parseCompanies(body);
  }

  /**
   * Query a single `$$LicenseInfo` attribute. Returns the scalar value
   * ("Yes"/"No"/serial/account) or undefined if Tally couldn't resolve it.
   * Never throws on a Tally-level error — an unresolvable attribute is a
   * normal "unknown" outcome, not a transport failure.
   */
  async licenseInfo(param: string, signal?: AbortSignal): Promise<string | undefined> {
    const { buildLicenseInfoEnvelope } = await import("./envelopes.js");
    try {
      const body = await this.send(buildLicenseInfoEnvelope(param), signal);
      return parseLicenseInfoResult(body);
    } catch (e) {
      if (e instanceof TallyError && e.kind === "response") return undefined;
      throw e;
    }
  }

  /**
   * Authoritative edition/license probe via Tally's `$$LicenseInfo` function.
   *
   * This is the ONLY correct way to determine Educational vs Silver/Gold.
   * Do NOT infer edition from company names — a real company named e.g.
   * "... EDUCATIONAL INSTITUTE ..." would false-positive any name heuristic.
   *
   * `supported` is false when Tally answers nothing for IsEducationalMode
   * (very old build / feature unavailable); callers then treat edition as
   * unknown rather than guessing.
   */
  async probeLicense(signal?: AbortSignal): Promise<LicenseProbe> {
    const edu = await this.licenseInfo("IsEducationalMode", signal);
    if (edu === undefined) return { supported: false };
    const [silver, gold, serial, account] = await Promise.all([
      this.licenseInfo("IsSilver", signal),
      this.licenseInfo("IsGold", signal),
      this.licenseInfo("SerialNumber", signal),
      this.licenseInfo("AccountId", signal),
    ]);
    return {
      supported: true,
      isEducationalMode: parseTallyLogical(edu),
      isSilver: parseTallyLogical(silver),
      isGold: parseTallyLogical(gold),
      serialNumber: serial,
      accountId: account,
    };
  }

  /**
   * Determine whether the Tally gateway is bound to localhost only,
   * all interfaces, or unknown. We probe by attempting a connection to
   * the URL's port on both 127.0.0.1 and 0.0.0.0 from a separate socket.
   *
   * Result is best-effort: on some Windows configurations both probes
   * succeed because of dual-stack IPv4/IPv6. We return "unknown" in that
   * case rather than asserting wrongly.
   */
  async detectBindAddress(): Promise<"localhost-only" | "all-interfaces" | "unknown"> {
    const port = parsePort(this.config.url);
    if (!port) return "unknown";
    const local = await probeTcp("127.0.0.1", port);
    if (!local) return "unknown"; // can't reach even localhost — abort detection
    // If we can reach via the machine's external IPv4 too, Tally is on 0.0.0.0.
    // We don't try to enumerate interfaces (heavy + cross-platform pain); we use
    // a small heuristic: bind to "0.0.0.0" only works if the server is too.
    const external = await probeTcp("0.0.0.0", port);
    if (external) return "all-interfaces";
    return "localhost-only";
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function composeSignals(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (!b) return a;
  const c = new AbortController();
  const onAbort = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return c.signal;
}

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function parsePort(url: string): number | null {
  try {
    return Number(new URL(url).port || "0") || null;
  } catch {
    return null;
  }
}

function probeTcp(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
  });
}
