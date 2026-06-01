#!/usr/bin/env node
/**
 * Live demo: exercise every PR1 safety ring + the new postReceipt operation
 * against a running TallyPrime.
 *
 * Scenarios (run sequentially in one command):
 *
 *   1. GATE CLOSED            → assertGate throws TallyWriteBlockedError
 *   2. GATE OPEN, DECLINE     → confirmWrite() returns accepted=false, audit row
 *   3. GATE OPEN, DRY-RUN     → preview + audit, no Tally write
 *   4. GATE OPEN, REAL SUBMIT → posts a ₹1 receipt from a real Sundry Debtor
 *                                into Cash, audits the wire send, returns vchId
 *   5. AUDIT TAIL             → reads back the JSONL we just wrote
 *
 * To keep the user's regular audit log untouched, this script writes events
 * to a dedicated `~/.pi-tally/demo-audit/` directory.
 *
 * Tally requirements:
 *   - http://localhost:9000 reachable
 *   - Company "ZOSMAAI SOLUTIONS PRIVATE LIMITED" loaded
 *   - Ledgers "FOODSTORIES PRIVATE LIMITED" (Sundry Debtors) + "Cash" present
 *
 * Run with TypeScript on the fly via tsx-style loader, or compile-on-import:
 *
 *   $ node --experimental-strip-types scripts/manual-post-receipt.mjs
 *
 * Node 22.6+ has --experimental-strip-types, allowing direct import of .ts.
 * Falls back to plain JS by reading source from the dist if you build first.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { TallyClient, TallyError } from "../src/client.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { TallyWriteBlockedError } from "../src/safety/gates.ts";
import { postReceipt } from "../src/operations/post-receipt.ts";
import { readAuditEvents } from "../src/audit/log.ts";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const PARTY = "FOODSTORIES PRIVATE LIMITED";
const DESTINATION = "Cash";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const AUDIT_DIR = join(homedir(), ".pi-tally", "demo-audit");
mkdirSync(AUDIT_DIR, { recursive: true });

// Make a minimal extension-context shim that auto-answers ui.confirm.
function fakeCtx(autoConfirm) {
  return {
    cwd: process.cwd(),
    ui: {
      confirm: async (title, body) => {
        console.log(`\n  ┌─ ctx.ui.confirm  ──── ${title}`);
        for (const line of body.split("\n")) console.log(`  │ ${line}`);
        console.log(`  └─ user answers: ${autoConfirm ? "YES" : "NO"}\n`);
        return autoConfirm;
      },
      notify: (m, lvl = "info") => console.log(`  [notify:${lvl}] ${m}`),
      select: async () => undefined,
    },
  };
}

function banner(n, title) {
  const line = "═".repeat(72);
  console.log(`\n${line}\n  Scenario ${n}: ${title}\n${line}`);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  console.log(`\npi-tally live demo  ·  company: ${COMPANY}`);
  console.log(`audit dir: ${AUDIT_DIR}`);
  console.log(`date     : ${TODAY}`);

  const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 5000 });

  // Sanity: confirm Tally is up
  try {
    const cos = await client.listCompanies();
    const match = cos.find((c) => c.name === COMPANY);
    if (!match) {
      console.error(`\n❌ Company "${COMPANY}" is not loaded in TallyPrime.`);
      console.error(`   Loaded: ${cos.map((c) => c.name).join(", ") || "(none)"}`);
      process.exit(2);
    }
    console.log(`✓ Tally reachable, target company is loaded.`);
  } catch (e) {
    console.error(`\n❌ Could not reach Tally: ${e.message}`);
    process.exit(2);
  }

  const baseReceipt = {
    company: COMPANY,
    party: PARTY,
    destinationLedger: DESTINATION,
    date: TODAY,
    amount: 1,
    narration: "pi-tally smoke test (₹1, safe to delete)",
    // FOODSTORIES is a Sundry Debtor with IsBilledWise=Yes — Tally silently
    // rejects (CREATED=0) any voucher against such a party with no bill
    // allocation. On Account is the safe default when we don't know which
    // bill to attach against.
    billRef: { type: "On Account", name: "pi-tally-smoke" },
  };

  // ----- Scenario 1: gate CLOSED ---------------------------------------
  banner(1, "Gate CLOSED → must refuse before reaching Tally");
  try {
    await postReceipt(
      fakeCtx(true),
      { ...DEFAULT_CONFIG }, // all gates false
      client,
      AUDIT_DIR,
      baseReceipt,
    );
    console.log("  ❌ UNEXPECTED: postReceipt returned without throwing!");
  } catch (e) {
    if (e instanceof TallyWriteBlockedError) {
      console.log(`  ✓ Got expected TallyWriteBlockedError`);
      console.log(`    code       : ${e.code}`);
      console.log(`    category   : ${e.category}`);
      console.log(`    userAction : ${e.userAction}`);
      console.log(`    message    : ${e.message}`);
    } else {
      throw e;
    }
  }

  // Open the gate for the rest of the scenarios
  const cfgOpen = {
    ...DEFAULT_CONFIG,
    writeGates: { ...DEFAULT_CONFIG.writeGates, vouchers: true },
  };

  // ----- Scenario 2: gate OPEN, user DECLINES the confirm modal --------
  banner(2, "Gate OPEN, user DECLINES → audit declined, no Tally write");
  const declineResult = await postReceipt(
    fakeCtx(false),
    cfgOpen,
    client,
    AUDIT_DIR,
    baseReceipt,
  );
  console.log(`  outcome: ${declineResult.outcome}`);
  if (declineResult.outcome !== "declined") {
    console.log("  ❌ UNEXPECTED outcome");
  } else {
    console.log("  ✓ Decline path honored, no envelope sent.");
  }

  // ----- Scenario 3: gate OPEN, user ACCEPTS, dry-run ------------------
  banner(3, "Gate OPEN, user ACCEPTS, dry-run → preview + audit, NO write");
  const dryResult = await postReceipt(
    fakeCtx(true),
    cfgOpen,
    client,
    AUDIT_DIR,
    { ...baseReceipt, dryRun: true },
  );
  console.log(`  outcome: ${dryResult.outcome}`);
  if (dryResult.outcome !== "dry-run") {
    console.log("  ❌ UNEXPECTED outcome");
  } else {
    console.log("  ✓ Dry-run completed without contacting Tally for the import.");
  }

  // ----- Scenario 4: REAL SUBMIT ---------------------------------------
  banner(4, `REAL SUBMIT → ₹1 receipt: ${PARTY} → ${DESTINATION}`);
  try {
    const result = await postReceipt(
      fakeCtx(true),
      cfgOpen,
      client,
      AUDIT_DIR,
      baseReceipt,
    );
    console.log(`  outcome: ${result.outcome}`);
    console.log(`  vchId  : ${result.vchId ?? "(not returned by Tally)"}`);
    if (result.outcome === "submitted") {
      console.log("  ✓ Voucher created in Tally. Check Day Book to verify.");
    }
  } catch (e) {
    if (e instanceof TallyError) {
      console.log(`  ❌ Tally rejected the envelope:`);
      console.log(`     kind: ${e.kind}`);
      console.log(`     msg : ${e.message}`);
      if (e.raw) console.log(`     raw : ${e.raw.slice(0, 400)}`);
    } else {
      console.log(`  ❌ Unexpected error: ${e.message}`);
    }
  }

  // ----- Scenario 5: tail the audit log --------------------------------
  banner(5, `Audit log tail (${AUDIT_DIR})`);
  const events = readAuditEvents(AUDIT_DIR);
  console.log(`  ${events.length} event(s) recorded this run:`);
  for (const e of events) {
    const extras = Object.entries(e)
      .filter(([k]) => k !== "id" && k !== "ts" && k !== "kind")
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("  ");
    console.log(`    ${e.ts}  ${e.kind.padEnd(20)}  ${extras}`);
  }

  console.log(`\n✓ Demo complete.\n`);
}

main().catch((e) => {
  console.error("\n💥 Uncaught:", e);
  process.exit(1);
});
