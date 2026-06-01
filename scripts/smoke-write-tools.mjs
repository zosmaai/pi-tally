#!/usr/bin/env node
/**
 * End-to-end smoke test for the three v0.2 write operations
 * (postReceipt + postPayment + reverseReceiptVoucher) against live Tally.
 *
 * Walks through:
 *   1. postReceipt    — ₹3 from FOODSTORIES → Cash
 *   2. reverseReceiptVoucher — undo it via Payment
 *   3. postPayment    — ₹2 standalone payment to FOODSTORIES from Cash
 *   4. reverse the standalone payment manually via postReceipt (round-trip)
 *
 * Books end in exact starting balance. Audit dir at ~/.pi-tally/demo-audit
 * shows the full chain of events.
 *
 * Run:
 *   $ npx tsx scripts/smoke-write-tools.mjs
 */
import { TallyClient } from "../src/client.ts";
import { postReceipt } from "../src/operations/post-receipt.ts";
import { postPayment } from "../src/operations/post-payment.ts";
import { reverseReceiptVoucher } from "../src/operations/reverse-voucher.ts";
import { DEFAULT_CONFIG, formatINR } from "../src/config.ts";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const AUDIT_DIR = join(homedir(), ".pi-tally", "demo-audit");
mkdirSync(AUDIT_DIR, { recursive: true });

const cfg = {
  ...DEFAULT_CONFIG,
  defaultCompany: COMPANY,
  writeGates: { ...DEFAULT_CONFIG.writeGates, vouchers: true }, // gate open for demo
};

const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

// Auto-confirm ctx (skips the actual modal for smoke purposes)
const ctx = {
  ui: {
    confirm: async (title, body) => {
      console.log(`\n  [modal] ${title}`);
      console.log(body.split("\n").map((l) => `    ${l}`).join("\n"));
      console.log("  [auto-accept]");
      return true;
    },
    notify: () => {},
    select: async () => null,
  },
};

const PARTY = "FOODSTORIES PRIVATE LIMITED";
const DEST = "Cash";
const DATE = "2026-06-01";

console.log(`Smoke: live write-tool flow against ${COMPANY}\n${"═".repeat(72)}`);

// Capture starting balance
async function bal() {
  const body = await client.send(
    `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>X</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="X" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name,ClosingBalance</FETCH><FILTER>F</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="F">$Name = "${PARTY}"</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`,
  );
  const m = body.match(/<CLOSINGBALANCE>([^<]+)</);
  return m?.[1]?.trim() ?? "?";
}

const before = await bal();
console.log(`\nFOODSTORIES balance before:  ${before}`);

// Step 1: post receipt via NEW operation layer
console.log(`\n[1/3] postReceipt(₹3)`);
const r1 = await postReceipt(ctx, cfg, client, AUDIT_DIR, {
  company: COMPANY,
  party: PARTY,
  destinationLedger: DEST,
  date: DATE,
  amount: 3,
  narration: "PR2 smoke — postReceipt path",
});
console.log(`  → outcome=${r1.outcome} vchId=${r1.vchId}`);

const after1 = await bal();
console.log(`  FOODSTORIES balance now:   ${after1}`);

// Step 2: reverse it via reverse-voucher operation
console.log(`\n[2/3] reverseReceiptVoucher(vch ${r1.vchId})`);
const r2 = await reverseReceiptVoucher(ctx, cfg, client, AUDIT_DIR, {
  company: COMPANY,
  party: PARTY,
  destinationLedger: DEST,
  date: DATE,
  amount: 3,
  originalVoucherRef: `MASTERID:${r1.vchId}`,
});
console.log(`  → outcome=${r2.outcome} vchId=${r2.vchId}`);

const after2 = await bal();
console.log(`  FOODSTORIES balance now:   ${after2}`);

// Step 3: standalone payment + manual reverse via receipt
console.log(`\n[3/3] postPayment(₹2) then offsetting postReceipt(₹2)`);
const p1 = await postPayment(ctx, cfg, client, AUDIT_DIR, {
  company: COMPANY,
  party: PARTY,
  sourceLedger: DEST,
  date: DATE,
  amount: 2,
  narration: "PR2 smoke — postPayment path",
});
console.log(`  payment vchId=${p1.vchId}`);

const p2 = await postReceipt(ctx, cfg, client, AUDIT_DIR, {
  company: COMPANY,
  party: PARTY,
  destinationLedger: DEST,
  date: DATE,
  amount: 2,
  narration: "PR2 smoke — round-trip receipt to cancel the payment",
});
console.log(`  offsetting receipt vchId=${p2.vchId}`);

const finalBal = await bal();
console.log(`\n${"═".repeat(72)}`);
console.log(`FOODSTORIES balance start: ${before}`);
console.log(`FOODSTORIES balance end:   ${finalBal}`);
console.log(
  before === finalBal
    ? `\n✓ Balance reconciles. Books unchanged net. Audit log at ${AUDIT_DIR}`
    : `\n✗ Balance MISMATCH — investigate.`,
);
