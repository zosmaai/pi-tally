/**
 * parseTallyError tests, with special focus on the silent-reject case
 * that bit us in PR1: STATUS=0 + empty BODY, no LINEERROR, no ERRORMSG.
 *
 * That shape happens when:
 *   - HEADER omits <ID>Vouchers</ID> on a voucher import
 *   - HEADER has wrong TALLYREQUEST type (Export vs Import)
 *   - Envelope is otherwise structurally rejected before processing
 *
 * Before this test, parseTallyError returned null for that shape and the
 * caller treated it as success — masking a hard reject.
 */

import { describe, expect, it } from "vitest";
import { parseTallyError } from "../../src/parse.js";

describe("parseTallyError — silent-reject detection", () => {
  it("flags STATUS=0 with no ERRORMSG/LINEERROR as a malformed-envelope error", () => {
    const body = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <STATUS>0</STATUS>
 </HEADER>
 <BODY>
  <DATA>
   <IMPORTRESULT>
    <CREATED>0</CREATED>
    <ALTERED>0</ALTERED>
    <DELETED>0</DELETED>
   </IMPORTRESULT>
  </DATA>
 </BODY>
</ENVELOPE>`;
    const err = parseTallyError(body);
    expect(err).not.toBeNull();
    expect(err!.kind).toBe("response");
    // Message should point the operator at the most likely cause
    expect(err!.message).toMatch(/STATUS=0/);
    expect(err!.message).toMatch(/HEADER|envelope|malformed/i);
  });

  it("flags an utterly empty STATUS=0 body too", () => {
    const body = `<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY></BODY></ENVELOPE>`;
    expect(parseTallyError(body)).not.toBeNull();
  });

  it("does NOT flag STATUS=1 responses as errors", () => {
    const body = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED></IMPORTRESULT></DATA></BODY></ENVELOPE>`;
    expect(parseTallyError(body)).toBeNull();
  });

  it("does NOT flag responses without a STATUS tag (read/collection responses)", () => {
    // Collection / report exports often skip STATUS entirely
    const body = `<ENVELOPE><BODY><COLLECTION><LEDGER>...</LEDGER></COLLECTION></BODY></ENVELOPE>`;
    expect(parseTallyError(body)).toBeNull();
  });

  it("prefers an explicit LINEERROR over the generic STATUS=0 message", () => {
    // LINEERROR is more informative — always surface it instead of the generic.
    const body = `<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY><DATA><IMPORTRESULT><LINEERROR>Voucher does not exist!</LINEERROR><CREATED>0</CREATED></IMPORTRESULT></DATA></BODY></ENVELOPE>`;
    const err = parseTallyError(body)!;
    expect(err.kind).toBe("lineerror");
    expect(err.message).toBe("Voucher does not exist!");
  });

  it("prefers an explicit ERRORMSG over the generic STATUS=0 message", () => {
    const body = `<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY><DATA><ERRORMSG>Bad request</ERRORMSG></DATA></BODY></ENVELOPE>`;
    const err = parseTallyError(body)!;
    expect(err.kind).toBe("response");
    expect(err.message).toBe("Bad request");
  });
});
