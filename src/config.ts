/**
 * Persisted user/project config.
 *
 * Two-tier lookup:
 *   1. Project config at  ./.pi/pi-tally.json (project root)
 *   2. User config at     ~/.pi-tally/config.json
 *
 * Project wins for any defined key. Write-gates are READ from the merge but
 * always WRITTEN to the user config — gates must follow the operator, not
 * leak through git checkouts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { WriteGateState } from "./types.js";

export interface TallyConfig {
  /** Gateway URL. Default: http://localhost:9000 */
  url: string;
  /** Active company. If unset, Tally uses its own active company. */
  defaultCompany?: string;
  /** Request timeout in ms. */
  timeoutMs: number;
  /** Per-category write gates. */
  writeGates: WriteGateState;
  /** Confirmation policy for write tools. */
  confirmMode: "off" | "writes" | "all";
  /** User has acknowledged the 0.0.0.0 bind risk for this machine. */
  networkRiskAcknowledged: boolean;
  /** Allow the tally_raw_xml escape hatch (also requires gate). */
  allowRawXml: boolean;
}

export const DEFAULT_CONFIG: TallyConfig = {
  url: "http://localhost:9000",
  timeoutMs: 15000,
  writeGates: { masters: false, vouchers: false, bulkImport: false, rawXml: false },
  confirmMode: "writes",
  networkRiskAcknowledged: false,
  allowRawXml: false,
};

export function userConfigPath(): string {
  return join(homedir(), ".pi-tally", "config.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "pi-tally.json");
}

export function loadConfig(cwd: string): TallyConfig {
  const user = readJsonIfExists(userConfigPath()) ?? {};
  const project = readJsonIfExists(projectConfigPath(cwd)) ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...user,
    ...project,
    writeGates: {
      ...DEFAULT_CONFIG.writeGates,
      ...(user.writeGates ?? {}),
      ...(project.writeGates ?? {}),
    },
  };
}

export function saveUserConfig(patch: Partial<TallyConfig>): TallyConfig {
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const current = readJsonIfExists(path) ?? {};
  const next = { ...DEFAULT_CONFIG, ...current, ...patch };
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
  return next as TallyConfig;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJsonIfExists(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Indian-numbering currency formatter (₹1,23,45,678.90).
 * Used by every tool's render output. Lives in config.ts because every layer
 * needs it and we don't want a dedicated `format.ts` for one function.
 */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fixed = abs.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  // Indian grouping: last 3 digits, then groups of 2
  const intStr = intPart!;
  let head = "";
  let tail = intStr;
  if (intStr.length > 3) {
    head = intStr.slice(0, intStr.length - 3);
    tail = intStr.slice(intStr.length - 3);
    head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  }
  const grouped = head ? `${head},${tail}` : tail;
  return `${sign}₹${grouped}.${decPart}`;
}
