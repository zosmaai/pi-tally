// Live smoke test against a running TallyPrime.
// Run from project root with: node test/smoke-live.mjs

const URL = "http://localhost:9000";

function envListCompanies() {
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER>
 <BODY><DESC>
   <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
   <TDL><TDLMESSAGE><COLLECTION NAME="List of Companies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name, StartingFrom, BooksFrom</FETCH></COLLECTION></TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

function envListLedgers(company) {
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Ledgers</ID></HEADER>
 <BODY><DESC>
   <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
     <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
   <TDL><TDLMESSAGE><COLLECTION NAME="List of Ledgers" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name, Parent, ClosingBalance</FETCH></COLLECTION></TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

function envTrialBalance(company) {
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Trial Balance</ID></HEADER>
 <BODY><DESC>
   <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
     <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
   </STATICVARIABLES>
 </DESC></BODY>
</ENVELOPE>`;
}

async function post(envelope) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: envelope,
  });
  const body = await res.text();
  return { ms: Date.now() - t0, status: res.status, body };
}

function decode(s) {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Iterate every <TAG ...> opening tag and parse its attribute string into a map.
// Then return the value of attribute `attr` on each, filtered to entries where
// the attribute is present. This avoids the RESERVEDNAME shadow bug.
function extractAttr(xml, tag, attr) {
  const openRe = new RegExp("<" + tag + "(\\s[^>]*)>", "gi");
  const out = [];
  for (const m of xml.matchAll(openRe)) {
    const attrs = m[1];
    // Split on whitespace then re-join key="value" pairs
    const pairRe = /(\w[\w-]*)="([^"]*)"/g;
    for (const p of attrs.matchAll(pairRe)) {
      if (p[1].toUpperCase() === attr.toUpperCase()) {
        out.push(decode(p[2]));
        break;
      }
    }
  }
  return out;
}

function extractInner(xml, tag) {
  const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "gi");
  return [...xml.matchAll(re)].map((m) => decode(m[1].trim()));
}

async function main() {
  console.log("─── pi-tally live smoke test ───\n");

  // Test 1: list companies
  console.log("Test 1: list companies");
  const r1 = await post(envListCompanies());
  if (r1.status !== 200) {
    console.error(`  FAIL: HTTP ${r1.status}`);
    process.exit(1);
  }
  const companies = extractAttr(r1.body, "COMPANY", "NAME");
  console.log(`  ✅ ${companies.length} compan${companies.length === 1 ? "y" : "ies"} (${r1.ms}ms)`);
  for (const c of companies) console.log(`     · ${c}`);
  if (companies.length === 0) {
    console.error("  No companies loaded. Open one in TallyPrime, then re-run.");
    process.exit(1);
  }
  const activeCompany = companies[0];

  // Test 2: list ledgers
  console.log(`\nTest 2: list ledgers (company: ${activeCompany})`);
  const r2 = await post(envListLedgers(activeCompany));
  const ledgers = extractAttr(r2.body, "LEDGER", "NAME");
  console.log(`  ✅ ${ledgers.length} ledger(s) (${r2.ms}ms)`);
  console.log("     First 8:");
  for (const l of ledgers.slice(0, 8)) console.log(`       · ${l}`);

  // Test 3: trial balance
  console.log(`\nTest 3: trial balance`);
  const r3 = await post(envTrialBalance(activeCompany));
  console.log(`  ✅ response ${r3.body.length} bytes (${r3.ms}ms)`);
  const dispNames = extractInner(r3.body, "DSPDISPNAME").slice(0, 8);
  console.log(`     Sampled ledger rows: ${dispNames.length}`);
  for (const n of dispNames) console.log(`       · ${n}`);

  console.log("\n─── all smoke tests passed ───");
}

main().catch((e) => {
  console.error("smoke test failed:", e);
  process.exit(1);
});
