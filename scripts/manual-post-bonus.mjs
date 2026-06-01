#!/usr/bin/env node
/**
 * Bonus demo: post a small receipt against a different party + different
 * destination, to prove the operation generalises. Also exercises an
 * intentional bad input (negative amount) to confirm the build-time guard.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TallyClient, TallyError } from "../src/client.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { postReceipt } from "../src/operations/post-receipt.ts";
import { readAuditEvents } from "../src/audit/log.ts";

const AUDIT_DIR = join(homedir(), ".pi-tally", "demo-audit");
mkdirSync(AUDIT_DIR, { recursive: true });

const okCtx = {
  cwd: process.cwd(),
  ui: {
    confirm: async (title, body) => {
      console.log(`\n  [modal] ${title}\n${body.split("\n").map((l) => `    ${l}`).join("\n")}\n  [answers: YES]\n`);
      return true;
    },
    notify: (m, lvl = "info") => console.log(`  [notify:${lvl}] ${m}`),
    select: async () => undefined,
  },
};

const cfgOpen = {
  ...DEFAULT_CONFIG,
  writeGates: { ...DEFAULT_CONFIG.writeGates, vouchers: true },
};

const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

const TODAY = new Date().toISOString().slice(0, 10);

console.log("──────────────────────────────────────────────────────────────");
console.log(" Receipt #1: ₹5 from SENSALABS LLP → ICICI BANK");
console.log("──────────────────────────────────────────────────────────────");
try {
  const r = await postReceipt(okCtx, cfgOpen, client, AUDIT_DIR, {
    company: "ZOSMAAI SOLUTIONS PRIVATE LIMITED",
    party: "SENSALABS LLP",
    destinationLedger: "ICICI BANK",
    date: TODAY,
    amount: 5,
    narration: "pi-tally generalisation test (safe to delete)",
    billRef: { type: "On Account", name: "pi-tally-bonus-1" },
  });
  console.log(`  ✓ outcome=${r.outcome}  vchId=${r.vchId}`);
} catch (e) {
  if (e instanceof TallyError) console.log(`  ✗ TallyError: ${e.message}`);
  else console.log(`  ✗ ${e.message}`);
}

console.log("\n──────────────────────────────────────────────────────────────");
console.log(" Receipt #2: ₹2.50 from DASHFIT PRIVATE LIMITED → Cash");
console.log(" (DASHFIT has 0 balance — tests posting against a flat party)");
console.log("──────────────────────────────────────────────────────────────");
try {
  const r = await postReceipt(okCtx, cfgOpen, client, AUDIT_DIR, {
    company: "ZOSMAAI SOLUTIONS PRIVATE LIMITED",
    party: "DASHFIT PRIVATE LIMITED",
    destinationLedger: "Cash",
    date: TODAY,
    amount: 2.5,
    narration: "pi-tally flat-party test",
    billRef: { type: "On Account", name: "pi-tally-bonus-2" },
  });
  console.log(`  ✓ outcome=${r.outcome}  vchId=${r.vchId}`);
} catch (e) {
  if (e instanceof TallyError) console.log(`  ✗ TallyError: ${e.message}`);
  else console.log(`  ✗ ${e.message}`);
}

console.log("\n──────────────────────────────────────────────────────────────");
console.log(" Bad input: amount = -10 (must fail BEFORE the wire)");
console.log("──────────────────────────────────────────────────────────────");
try {
  await postReceipt(okCtx, cfgOpen, client, AUDIT_DIR, {
    company: "ZOSMAAI SOLUTIONS PRIVATE LIMITED",
    party: "DASHFIT PRIVATE LIMITED",
    destinationLedger: "Cash",
    date: TODAY,
    amount: -10,
    narration: "should never reach Tally",
  });
  console.log("  ❌ UNEXPECTED: negative amount was accepted!");
} catch (e) {
  console.log(`  ✓ Rejected client-side: ${e.message}`);
}

console.log("\n──────────────────────────────────────────────────────────────");
console.log(" Final audit log (last 6 events)");
console.log("──────────────────────────────────────────────────────────────");
const events = readAuditEvents(AUDIT_DIR).slice(-6);
for (const e of events) {
  const extras = Object.entries(e)
    .filter(([k]) => k !== "id" && k !== "ts" && k !== "kind")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  console.log(`  ${e.ts}  ${e.kind.padEnd(20)}  ${extras}`);
}
