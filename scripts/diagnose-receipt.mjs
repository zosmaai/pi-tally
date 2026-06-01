#!/usr/bin/env node
/**
 * Diagnose Tally Receipt rejection. Tries multiple envelope variants
 * and prints the response for each so we can spot what differs.
 */
import { TallyClient } from "../src/client.ts";

const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const DATE = "20260601";
const PARTY = "FOODSTORIES PRIVATE LIMITED";
const DEST = "Cash";
const AMT = "1.00";
const NEG_AMT = "-1.00";

function variant(name, voucherInner) {
  return {
    name,
    xml: `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Import</TALLYREQUEST>
  <TYPE>Data</TYPE>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherInner}
   </TALLYMESSAGE>
  </DATA>
 </BODY>
</ENVELOPE>`,
  };
}

const variants = [
  variant(
    "A. Original (signed amounts + ISDEEMEDPOSITIVE + OBJVIEW + bill alloc)",
    `    <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${DATE}</DATE>
     <EFFECTIVEDATE>${DATE}</EFFECTIVEDATE>
     <NARRATION>diagnose A</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${PARTY}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${PARTY}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${AMT}</AMOUNT>
      <BILLALLOCATIONS.LIST>
       <NAME>pi-tally-A</NAME>
       <BILLTYPE>On Account</BILLTYPE>
       <AMOUNT>${AMT}</AMOUNT>
      </BILLALLOCATIONS.LIST>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${DEST}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${NEG_AMT}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`,
  ),
  variant(
    "B. Same but unsigned (positive amounts everywhere, ISDEEMEDPOSITIVE only)",
    `    <VOUCHER VCHTYPE="Receipt" ACTION="Create">
     <DATE>${DATE}</DATE>
     <NARRATION>diagnose B</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${PARTY}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${PARTY}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${AMT}</AMOUNT>
      <BILLALLOCATIONS.LIST>
       <NAME>pi-tally-B</NAME>
       <BILLTYPE>On Account</BILLTYPE>
       <AMOUNT>${AMT}</AMOUNT>
      </BILLALLOCATIONS.LIST>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${DEST}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${AMT}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`,
  ),
  variant(
    "C. With LEDGERENTRIES.LIST (singular, older spelling)",
    `    <VOUCHER VCHTYPE="Receipt" ACTION="Create">
     <DATE>${DATE}</DATE>
     <NARRATION>diagnose C</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${PARTY}</PARTYLEDGERNAME>
     <LEDGERENTRIES.LIST>
      <LEDGERNAME>${PARTY}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${AMT}</AMOUNT>
     </LEDGERENTRIES.LIST>
     <LEDGERENTRIES.LIST>
      <LEDGERNAME>${DEST}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${NEG_AMT}</AMOUNT>
     </LEDGERENTRIES.LIST>
    </VOUCHER>`,
  ),
  variant(
    "D. Date 2026-03-31 (within FY25-26 instead of FY26-27)",
    `    <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>20260331</DATE>
     <EFFECTIVEDATE>20260331</EFFECTIVEDATE>
     <NARRATION>diagnose D</NARRATION>
     <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
     <PARTYLEDGERNAME>${PARTY}</PARTYLEDGERNAME>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${PARTY}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${AMT}</AMOUNT>
      <BILLALLOCATIONS.LIST>
       <NAME>pi-tally-D</NAME>
       <BILLTYPE>On Account</BILLTYPE>
       <AMOUNT>${AMT}</AMOUNT>
      </BILLALLOCATIONS.LIST>
     </ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${DEST}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>${NEG_AMT}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`,
  ),
];

for (const v of variants) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`▸ ${v.name}`);
  console.log("=".repeat(72));
  try {
    const body = await client.send(v.xml);
    console.log(body);
  } catch (e) {
    console.log(`THREW: ${e.message}`);
    if (e.raw) console.log(`raw: ${e.raw}`);
  }
}
