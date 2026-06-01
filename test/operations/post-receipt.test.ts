/**
 * Tests for parsePostVoucherResponse — the only logic in the post-receipt
 * operation that isn't already covered by gates / confirm / envelope tests.
 *
 * Tally's voucher-import response is wildly inconsistent across versions.
 * Known successful shapes:
 *
 *   <RESPONSE>
 *     <CREATED>1</CREATED>
 *     <ALTERED>0</ALTERED>
 *     <LASTVCHID>1234</LASTVCHID>
 *     <LASTMID>5678</LASTMID>
 *   </RESPONSE>
 *
 *   or a wrapper:
 *
 *   <ENVELOPE><CREATED>1</CREATED>...
 *
 * Some Prime builds also drop <LASTVCHID> entirely and only emit
 * <CREATED>1</CREATED>. We treat created>=1 as success.
 *
 * Failure shapes are already handled by TallyClient (LINEERROR / ERRORMSG)
 * before the response reaches the parser, so we only test success-path
 * normalization here.
 */

import { describe, expect, it } from "vitest";
import { parsePostVoucherResponse } from "../../src/operations/post-receipt.js";

describe("parsePostVoucherResponse", () => {
  it("extracts created/altered/vchId from a flat RESPONSE block", () => {
    const r = parsePostVoucherResponse(`<RESPONSE>
      <CREATED>1</CREATED>
      <ALTERED>0</ALTERED>
      <LASTVCHID>4711</LASTVCHID>
      <LASTMID>200</LASTMID>
    </RESPONSE>`);
    expect(r.created).toBe(1);
    expect(r.altered).toBe(0);
    expect(r.lastVchId).toBe("4711");
  });

  it("works without an outer RESPONSE wrapper", () => {
    const r = parsePostVoucherResponse(`<CREATED>2</CREATED><ALTERED>0</ALTERED><LASTVCHID>9</LASTVCHID>`);
    expect(r.created).toBe(2);
    expect(r.lastVchId).toBe("9");
  });

  it("treats missing LASTVCHID as undefined, not error", () => {
    const r = parsePostVoucherResponse(`<RESPONSE><CREATED>1</CREATED></RESPONSE>`);
    expect(r.created).toBe(1);
    expect(r.lastVchId).toBeUndefined();
  });

  it("flags created===0 as a no-op (Tally accepted but silently ignored)", () => {
    const r = parsePostVoucherResponse(`<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED></RESPONSE>`);
    expect(r.created).toBe(0);
    expect(r.success).toBe(false);
  });

  it("created>=1 marks success even with no vchId", () => {
    const r = parsePostVoucherResponse(`<CREATED>1</CREATED>`);
    expect(r.success).toBe(true);
  });
});
