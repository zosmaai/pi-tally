#!/usr/bin/env node
/**
 * Quick probe of voucher-delete envelope shapes to find which one Tally accepts.
 * Targets MasterID 449 (a cancelled stub — safe to nuke).
 */
import { TallyClient } from "../src/client.ts";
const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const GUID = "233c8bb2-122e-4757-82c0-f160ae1d734b-000001c1"; // MasterID 449
const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

const variants = [
  {
    name: "V1: REMOTEID attr + DATE element",
    inner: `<VOUCHER REMOTEID="${GUID}" VCHTYPE="Receipt" ACTION="Delete"><DATE>20260601</DATE></VOUCHER>`,
  },
  {
    name: "V2: <GUID> child element + DATE",
    inner: `<VOUCHER VCHTYPE="Receipt" ACTION="Delete"><DATE>20260601</DATE><GUID>${GUID}</GUID></VOUCHER>`,
  },
  {
    name: "V3: REMOTEID attr + DATE + MASTERID body",
    inner: `<VOUCHER REMOTEID="${GUID}" VCHTYPE="Receipt" ACTION="Delete"><DATE>20260601</DATE><MASTERID>449</MASTERID></VOUCHER>`,
  },
  {
    name: "V4: TAGNAME=MasterID TAGVALUE=449 Alter+ISDELETED",
    inner: `<VOUCHER DATE="20260601" TAGNAME="MasterID" TAGVALUE="449" Action="Alter" VCHTYPE="Receipt"><ISDELETED>Yes</ISDELETED></VOUCHER>`,
  },
  {
    name: "V5: REMOTEID + Alter + ISDELETED",
    inner: `<VOUCHER REMOTEID="${GUID}" VCHTYPE="Receipt" ACTION="Alter"><DATE>20260601</DATE><ISDELETED>Yes</ISDELETED></VOUCHER>`,
  },
];

for (const v of variants) {
  const env = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE>${v.inner}</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
  console.log(`\n▸ ${v.name}`);
  try {
    const body = await client.send(env);
    const get = (t) => body.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "i"))?.[1]?.trim();
    console.log(`  status=${get("STATUS")} deleted=${get("DELETED")} altered=${get("ALTERED")} created=${get("CREATED")} errors=${get("ERRORS")} exc=${get("EXCEPTIONS")}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}
