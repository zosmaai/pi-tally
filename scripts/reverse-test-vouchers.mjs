#!/usr/bin/env node
/**
 * Reverse the smoke-test receipts by posting offsetting Payment vouchers.
 *
 * Why this instead of Delete:
 *   - Tally's XML gateway refuses ACTION="Delete" without UI-level
 *     "Allow Deletion" permission (only the desktop client can flip it).
 *   - ACTION="Alter" + ISDELETED=Yes is accepted (altered=1) but the
 *     flag does NOT take effect; the voucher remains active.
 *   - Reversal entries are the textbook accounting fix anyway: the
 *     audit trail of "we posted X, then reversed it" is more honest
 *     than silent deletion in a real production book.
 *
 * Pairing (Receipt → Payment reversal):
 *   Receipt 446: Cash Dr 1     , FOODSTORIES Cr 1     → Payment: FOODSTORIES Dr 1   , Cash Cr 1
 *   Receipt 447: ICICI Dr 5    , SENSALABS   Cr 5     → Payment: SENSALABS Dr 5     , ICICI Cr 5
 *   Receipt 448: Cash Dr 2.50  , DASHFIT     Cr 2.50  → Payment: DASHFIT Dr 2.50    , Cash Cr 2.50
 *
 * Tally Payment voucher sign convention (mirror of Receipt):
 *   Party  Dr → ISDEEMEDPOSITIVE=Yes, AMOUNT negative
 *   Cash   Cr → ISDEEMEDPOSITIVE=No,  AMOUNT positive
 */
import { TallyClient, TallyError } from "../src/client.ts";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendAuditEvent } from "../src/audit/log.ts";

const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const DATE = "20260601";
const AUDIT_DIR = join(homedir(), ".pi-tally", "demo-audit");
mkdirSync(AUDIT_DIR, { recursive: true });

const REVERSALS = [
  { party: "FOODSTORIES PRIVATE LIMITED", source: "Cash",       amount: 1.00, narration: "REVERSAL of pi-tally smoke test (vch 2)" },
  { party: "SENSALABS LLP",               source: "ICICI BANK", amount: 5.00, narration: "REVERSAL of pi-tally smoke test (vch 3)" },
  { party: "DASHFIT PRIVATE LIMITED",     source: "Cash",       amount: 2.50, narration: "REVERSAL of pi-tally smoke test (vch 4)" },
];

const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

function paymentEnvelope({ party, source, amount, narration }) {
  const amt = amount.toFixed(2);
  const neg = (-amount).toFixed(2);
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${DATE}</DATE>
     <EFFECTIVEDATE>${DATE}</EFFECTIVEDATE>
     <NARRATION>${narration}</NARRATION>
     <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${party}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${neg}</AMOUNT>
      <BILLALLOCATIONS.LIST>
       <NAME>pi-tally-reversal</NAME>
       <BILLTYPE>On Account</BILLTYPE>
       <AMOUNT>${neg}</AMOUNT>
      </BILLALLOCATIONS.LIST>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${source}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`;
}

function parseResp(body) {
  const m = (tag) => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
    return body.match(re)?.[1]?.trim();
  };
  return {
    status: m("STATUS"),
    created: Number(m("CREATED") ?? 0),
    altered: Number(m("ALTERED") ?? 0),
    lastVchId: m("LASTVCHID"),
    errors: m("ERRORS"),
    exceptions: m("EXCEPTIONS"),
  };
}

console.log(`Posting ${REVERSALS.length} reversal Payment vouchers to ${COMPANY}\n`);
let okCount = 0;

for (const r of REVERSALS) {
  console.log(`▸ ₹${r.amount.toFixed(2)} ${r.party} ← ${r.source}`);
  try {
    const body = await client.send(paymentEnvelope(r));
    const resp = parseResp(body);
    console.log(`  status=${resp.status} created=${resp.created} altered=${resp.altered} vchId=${resp.lastVchId ?? "?"} errors=${resp.errors ?? "-"} exc=${resp.exceptions ?? "-"}`);
    appendAuditEvent(AUDIT_DIR, {
      kind: resp.created >= 1 ? "reversal.submitted" : "reversal.failed",
      tool: "reverse-test-vouchers",
      party: r.party,
      source: r.source,
      amount: r.amount,
      vchId: resp.lastVchId,
    });
    if (resp.created >= 1) {
      console.log(`  ✓ Reversed via Payment voucher ${resp.lastVchId}`);
      okCount++;
    }
  } catch (e) {
    if (e instanceof TallyError) console.log(`  ✗ ${e.kind}: ${e.message}`);
    else console.log(`  ✗ ${e.message}`);
  }
}

console.log(`\n${okCount}/${REVERSALS.length} reversals posted. Balances should be back to baseline.`);
