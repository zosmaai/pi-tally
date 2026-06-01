/**
 * tally_health — gateway probe + active company + write-gate state.
 *
 * The first tool the LLM (per SKILL.md pre-flight protocol) calls in any
 * Tally session. Surfaces:
 *   - Gateway reachable + response time
 *   - Network bind state (warns on 0.0.0.0)
 *   - Loaded companies + which is active
 *   - Education mode banner
 *   - Write-gate state per category
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { TallyClient, TallyError } from "../../client.js";
import { loadConfig, formatINR } from "../../config.js";
import type { HealthInfo } from "../../types.js";

const PARAMS = Type.Object({});

export function registerHealthTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tally_health",
    label: "Tally Health",
    description:
      "Probes the Tally gateway. Returns reachability, version (if available), loaded companies, active company, books range, network bind warning, and write-gate state. MUST be called once at the start of any Tally session before any other tool.",
    promptSnippet:
      "Probe Tally gateway and report companies + active company + write-gate state",
    promptGuidelines: [
      "Call tally_health once at the start of any session that may interact with TallyPrime.",
      "If tally_health reports the gateway is unreachable, ask the user to confirm TallyPrime is running and a company is loaded; do not retry blindly.",
      "If tally_health shows write gates closed and the user requests a write, instruct them to run /tally enable-writes <category> before retrying.",
    ],
    parameters: PARAMS,
    async execute(_id, _params, signal, _onUpdate, ctx) {
      const cfg = loadConfig(ctx.cwd);
      const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });

      const t0 = Date.now();
      let companies: HealthInfo["companies"] = [];
      let reachable = false;
      let errMsg: string | undefined;
      try {
        companies = await client.listCompanies();
        reachable = true;
      } catch (e) {
        reachable = false;
        errMsg = e instanceof TallyError ? e.message : (e as Error).message;
      }
      if (signal?.aborted) throw new Error("aborted");

      const responseMs = Date.now() - t0;

      let bindAddress: HealthInfo["bindAddress"] = "unknown";
      if (reachable) {
        try {
          bindAddress = await client.detectBindAddress();
        } catch {
          bindAddress = "unknown";
        }
      }

      const activeCompany = cfg.defaultCompany ?? companies[0]?.name;
      const isEducationMode =
        companies.some((c) => /educational|sample|company demo/i.test(c.name)) ?? false;

      const health: HealthInfo = {
        reachable,
        responseMs,
        bindAddress,
        isEducationMode,
        companies,
        activeCompany,
        writeGates: cfg.writeGates,
      };

      return {
        content: [{ type: "text", text: formatHealthForLlm(health, errMsg) }],
        details: health,
      };
    },
  });
}

function formatHealthForLlm(h: HealthInfo, errMsg?: string): string {
  const lines: string[] = [];
  lines.push(`Tally gateway: ${h.reachable ? "✅ reachable" : "❌ UNREACHABLE"}`);
  if (!h.reachable) {
    lines.push(`Error: ${errMsg ?? "unknown"}`);
    lines.push("");
    lines.push("Action: confirm TallyPrime is running and at least one company is loaded.");
    return lines.join("\n");
  }
  lines.push(`Response time: ${h.responseMs}ms`);
  lines.push(`Network bind: ${h.bindAddress}`);
  if (h.bindAddress === "all-interfaces") {
    lines.push(
      "⚠️  Tally is listening on 0.0.0.0 (all interfaces) with NO authentication. Anyone on the LAN can read/write the books. Run /tally lock-down or restrict via firewall.",
    );
  }
  if (h.isEducationMode) {
    lines.push("ℹ️  Educational Mode detected — voucher dates restricted to 1st/2nd/last of month.");
  }
  lines.push("");
  lines.push(`Loaded companies (${h.companies.length}):`);
  for (const c of h.companies) {
    const marker = c.name === h.activeCompany ? "→ " : "  ";
    lines.push(
      `${marker}${c.name}  (FY from ${c.startingFrom || "?"}, books from ${c.booksFrom || "?"})`,
    );
  }
  lines.push("");
  lines.push("Write gates:");
  lines.push(`  masters:     ${h.writeGates.masters ? "🟢 open" : "🔴 closed"}`);
  lines.push(`  vouchers:    ${h.writeGates.vouchers ? "🟢 open" : "🔴 closed"}`);
  lines.push(`  bulk-import: ${h.writeGates.bulkImport ? "🟢 open" : "🔴 closed"}`);
  lines.push(`  raw-xml:     ${h.writeGates.rawXml ? "🟢 open" : "🔴 closed"}`);
  lines.push("");
  lines.push("Tip: silenced suggestion sample — formatINR helper available, e.g. " + formatINR(123456.78));
  return lines.join("\n");
}
