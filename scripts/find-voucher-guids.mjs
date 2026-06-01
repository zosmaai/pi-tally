#!/usr/bin/env node
/**
 * Query Tally for ALL receipt vouchers in the current FY and dump
 * their MasterID + GUID + Number so we know what to delete.
 */
import { TallyClient } from "../src/client.ts";

const COMPANY = "ZOSMAAI SOLUTIONS PRIVATE LIMITED";
const client = new TallyClient({ url: "http://localhost:9000", timeoutMs: 10000 });

const env = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>Receipt Vouchers</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">20260401</SVFROMDATE>
    <SVTODATE TYPE="Date">20270331</SVTODATE>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Receipt Vouchers" ISMODIFY="No">
      <TYPE>Voucher</TYPE>
      <FETCH>MasterID, AlterID, GUID, REMOTEID, Date, VoucherNumber, VoucherTypeName, Narration, IsCancelled</FETCH>
      <FILTER>IsReceipt</FILTER>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="IsReceipt">$VoucherTypeName = "Receipt"</SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;

const body = await client.send(env);
console.log(body);
