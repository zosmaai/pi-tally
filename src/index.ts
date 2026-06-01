/**
 * @zosmaai/pi-tally — extension entry point.
 *
 * On session_start:
 *   - Loads config (~/.pi-tally/config.json + project override)
 *   - Probes Tally gateway (non-fatal — extension stays loaded if Tally is off)
 *   - Sets footer status with reachability + active company
 *   - Warns if Tally is bound to 0.0.0.0
 *
 * Registers:
 *   - v0.1 read tools (tally_health, list_companies, use_company, list_ledgers,
 *     list_groups, list_voucher_types, get_report)
 *   - /tally commands (setup, health, enable-writes, disable-writes,
 *     use-company, lock-down)
 *
 * v0.2 write tools (gated):
 *   - tally_post_receipt    (receipt voucher — money received)
 *   - tally_post_payment    (payment voucher — money paid out)
 *   - tally_reverse_voucher (offsetting payment to undo a receipt)
 *
 * Bulk-import + masters tools land in v0.3 behind their own gates.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TallyClient } from "./client.js";
import { loadConfig } from "./config.js";
import { registerCommands } from "./commands.js";
import { registerReadTools } from "./tools/read/index.js";
import { registerWriteTools } from "./tools/write/index.js";

export default function piTally(pi: ExtensionAPI): void {
  registerReadTools(pi);
  registerWriteTools(pi);
  registerCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    const cfg = loadConfig(ctx.cwd);
    const client = new TallyClient({ url: cfg.url, timeoutMs: 3000 });

    let companies;
    try {
      companies = await client.listCompanies();
    } catch {
      ctx.ui.setStatus(
        "pi-tally",
        `Tally: offline (${cfg.url})`,
      );
      return;
    }

    const active = cfg.defaultCompany ?? companies[0]?.name ?? "(none)";
    ctx.ui.setStatus("pi-tally", `Tally: ${companies.length} co. · active: ${trim(active, 24)}`);

    // Network bind warning (non-blocking, shown once per session)
    try {
      const bind = await client.detectBindAddress();
      if (bind === "all-interfaces" && !cfg.networkRiskAcknowledged) {
        ctx.ui.notify(
          "⚠️  Tally is listening on 0.0.0.0 with no auth. Anyone on your LAN can read/write your books. Run /tally setup or restrict via Windows Firewall.",
          "warning",
        );
      }
    } catch {
      /* bind detection is best-effort */
    }
  });
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
