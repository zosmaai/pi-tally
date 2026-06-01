import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerHealthTool } from "./health.js";
import { registerCompanyTools } from "./companies.js";
import { registerLedgerTools } from "./ledgers.js";
import { registerReportTools } from "./reports.js";

/** Register all v0.1 read tools. */
export function registerReadTools(pi: ExtensionAPI): void {
  registerHealthTool(pi);
  registerCompanyTools(pi);
  registerLedgerTools(pi);
  registerReportTools(pi);
}
