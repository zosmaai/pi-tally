/**
 * /tally commands — operator-facing controls.
 *
 * These are entrypoints for the human user, not the LLM. They handle
 * setup, gate management, and diagnostic actions that should not be
 * tool-callable.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { TallyClient } from "./client.js";
import { DEFAULT_CONFIG, loadConfig, saveUserConfig } from "./config.js";
import type { WriteGateState } from "./types.js";

type GateCategory = keyof WriteGateState;

const GATE_CATEGORIES: GateCategory[] = ["masters", "vouchers", "bulkImport", "rawXml"];

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("tally", {
    description: "pi-tally controls: setup | health | enable-writes | disable-writes | use-company | lock-down",
    handler: async (args, ctx) => {
      const [sub, ...rest] = args.trim().split(/\s+/);
      switch (sub) {
        case "":
        case "help":
          ctx.ui.notify(
            "/tally setup | health | enable-writes <category> | disable-writes <category> | use-company <name> | lock-down",
            "info",
          );
          return;
        case "setup":
          await runSetup(pi, ctx);
          return;
        case "health":
          await runHealth(ctx);
          return;
        case "enable-writes":
          await toggleGate(ctx, rest[0], true);
          return;
        case "disable-writes":
          await toggleGate(ctx, rest[0], false);
          return;
        case "use-company":
          await runUseCompany(ctx, rest.join(" "));
          return;
        case "lock-down":
          ctx.ui.notify(
            "Lock-down assistant lands in v0.2. For now, add a Windows Firewall rule blocking inbound TCP 9000 except from 127.0.0.1.",
            "warning",
          );
          return;
        default:
          ctx.ui.notify(`Unknown sub-command: ${sub}. Try /tally help.`, "warning");
      }
    },
  });
}

async function runSetup(
  _pi: ExtensionAPI,
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): Promise<void> {
  ctx.ui.notify("Running pi-tally setup…", "info");
  const cfg = loadConfig(ctx.cwd);
  const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });

  let companies;
  try {
    companies = await client.listCompanies();
  } catch (e) {
    ctx.ui.notify(
      `❌ Could not reach Tally at ${cfg.url}. Confirm TallyPrime is running with the HTTP gateway enabled (F1 → Settings → Connectivity → ODBC: Yes). Detail: ${(e as Error).message}`,
      "error",
    );
    return;
  }

  if (companies.length === 0) {
    ctx.ui.notify("⚠️  Tally is reachable but no company is loaded. Open one in TallyPrime first.", "warning");
    return;
  }

  const chosen = await ctx.ui.select(
    "Active company:",
    companies.map((c) => c.name),
  );
  if (!chosen) return;

  const bind = await client.detectBindAddress();
  if (bind === "all-interfaces") {
    const ack = await ctx.ui.confirm(
      "Network risk",
      "Tally is listening on 0.0.0.0 with no auth — your books are LAN-readable. Acknowledge and continue?",
    );
    if (!ack) {
      ctx.ui.notify(
        "Setup cancelled. Restrict TallyPrime to localhost via Windows Firewall, then re-run /tally setup.",
        "warning",
      );
      return;
    }
    saveUserConfig({ networkRiskAcknowledged: true });
  }

  saveUserConfig({
    ...DEFAULT_CONFIG,
    url: cfg.url,
    defaultCompany: chosen,
    timeoutMs: cfg.timeoutMs,
    networkRiskAcknowledged: cfg.networkRiskAcknowledged || bind === "all-interfaces",
  });

  ctx.ui.notify(
    `✅ pi-tally configured. Active company: ${chosen}. Write gates remain CLOSED — use /tally enable-writes <category> when ready.`,
    "info",
  );
}

async function runHealth(
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): Promise<void> {
  const cfg = loadConfig(ctx.cwd);
  const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
  try {
    const companies = await client.listCompanies();
    const bind = await client.detectBindAddress();
    ctx.ui.notify(
      `Tally OK. ${companies.length} compan${companies.length === 1 ? "y" : "ies"} loaded. Bind: ${bind}.`,
      "info",
    );
  } catch (e) {
    ctx.ui.notify(`Tally unreachable: ${(e as Error).message}`, "error");
  }
}

async function toggleGate(
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
  raw: string | undefined,
  open: boolean,
): Promise<void> {
  const norm = (raw ?? "").toLowerCase();
  const category: GateCategory | null =
    norm === "masters"
      ? "masters"
      : norm === "vouchers"
        ? "vouchers"
        : norm === "bulk-import" || norm === "bulkimport"
          ? "bulkImport"
          : norm === "raw-xml" || norm === "rawxml"
            ? "rawXml"
            : null;
  if (!category) {
    ctx.ui.notify(
      `Usage: /tally ${open ? "enable" : "disable"}-writes <masters|vouchers|bulk-import|raw-xml>`,
      "warning",
    );
    return;
  }

  if (open) {
    const ok = await ctx.ui.confirm(
      "Open write gate",
      `Open '${category}' gate? This allows the LLM to create/modify Tally data of this category. Each individual write will still ask for confirmation.`,
    );
    if (!ok) return;
  }

  const cfg = loadConfig(ctx.cwd);
  const next = { ...cfg.writeGates, [category]: open };
  saveUserConfig({ writeGates: next });
  ctx.ui.notify(`Gate '${category}' is now ${open ? "🟢 OPEN" : "🔴 CLOSED"}.`, "info");
}

async function runUseCompany(
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
  name: string,
): Promise<void> {
  if (!name) {
    ctx.ui.notify("Usage: /tally use-company <exact name>", "warning");
    return;
  }
  const cfg = loadConfig(ctx.cwd);
  const client = new TallyClient({ url: cfg.url, timeoutMs: cfg.timeoutMs });
  try {
    const companies = await client.listCompanies();
    const match = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      ctx.ui.notify(`Not loaded: ${name}. Loaded: ${companies.map((c) => c.name).join(", ")}`, "warning");
      return;
    }
    saveUserConfig({ defaultCompany: match.name });
    ctx.ui.notify(`Active company: ${match.name}`, "info");
  } catch (e) {
    ctx.ui.notify(`Tally unreachable: ${(e as Error).message}`, "error");
  }
}
