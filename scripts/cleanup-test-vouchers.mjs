#!/usr/bin/env node
/**
 * Delete the smoke-test Receipt vouchers (MasterID 446–451).
 *
 * Working envelope shape (discovered via scripts/probe-delete-variants.mjs):
 *
 *   <VOUCHER DATE="20260601"
 *            TAGNAME="MasterID" TAGVALUE="N"
 *            Action="Alter" VCHTYPE="Receipt">
 *     <ISDELETED>Yes</ISDELETED>
 *   </VOUCHER>
 *
 * Things that DID NOT work:
 *   - REMOTEID="<guid>" + ACTION="Delete"          → "Voucher does not exist!"
 *   - <GUID>...</GUID> child + ACTION="Delete"     → "Cannot delete unnamed object"
 *   - MASTERID body element + ACTION="Delete"      → "Voucher does not exist!"
 *   - ACTION="Cancel" + MASTERID                   → creates NEW cancelled voucher
 *   - REMOTEID + ACTION="Alter" + ISDELETED        → exceptions=1, no change
 *
 * The TAGNAME/TAGVALUE pattern is documented as the Tally-blessed way to
 * uniquely identify an existing voucher for Alter/Delete operations.
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

const TARGETS = [
  { masterId: 446, note: "₹1 FOODSTORIES → Cash" },
  { masterId: 447, note: "₹5 SENSALABS LLP → ICICI BANK" },
  { masterId: 448, note: "₹2.50 DASHFIT → Cash" },
  { masterId: 449, note: "cancelled stub" },
  { masterId: 450, note: "cancelled stub" },
  { masterId: 451, note: "cancelled stub" },
];

const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

function deleteEnvelope(masterId) {
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
   <TALLYMESSAGE>
    <VOUCHER DATE="${DATE}" TAGNAME="MasterID" TAGVALUE="${masterId}" Action="Alter" VCHTYPE="Receipt">
     <ISDELETED>Yes</ISDELETED>
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
    deleted: Number(m("DELETED") ?? 0),
    errors: m("ERRORS"),
    exceptions: m("EXCEPTIONS"),
  };
}

console.log(`Cleaning up ${TARGETS.length} smoke-test vouchers in ${COMPANY}\n`);
let okCount = 0;

for (const t of TARGETS) {
  console.log(`▸ MasterID=${t.masterId}  (${t.note})`);
  try {
    const body = await client.send(deleteEnvelope(t.masterId));
    const r = parseResp(body);
    const success = r.altered >= 1 || r.deleted >= 1;
    console.log(`  status=${r.status} altered=${r.altered} deleted=${r.deleted} errors=${r.errors ?? "-"} exc=${r.exceptions ?? "-"}`);
    appendAuditEvent(AUDIT_DIR, {
      kind: "cleanup.delete",
      tool: "cleanup-test-vouchers",
      masterId: t.masterId,
      altered: r.altered,
      deleted: r.deleted,
    });
    if (success) {
      console.log(`  ✓ Marked deleted`);
      okCount++;
    } else {
      console.log(`  ⚠ Already deleted or no change`);
    }
  } catch (e) {
    if (e instanceof TallyError) {
      console.log(`  ✗ ${e.kind}: ${e.message}`);
    } else {
      console.log(`  ✗ ${e.message}`);
    }
  }
}

console.log(`\n${okCount}/${TARGETS.length} vouchers cleaned. Verify with tally_list_ledgers.`);
