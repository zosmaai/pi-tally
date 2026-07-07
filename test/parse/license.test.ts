/**
 * Tests for $$LicenseInfo response parsing + edition derivation.
 *
 * Regression guard for the "false Education mode" bug: edition MUST come from
 * Tally's own $$LicenseInfo function, never from company names. A real company
 * named "PHOENIX EDUCATIONAL INSTITUTE PRIVATE LIMITED" must not flip the
 * edition to Educational.
 */

import { describe, expect, it } from "vitest";
import { parseLicenseInfoResult, parseTallyLogical } from "../../src/parse.js";
import { buildLicenseInfoEnvelope } from "../../src/envelopes.js";
import { deriveEdition } from "../../src/tools/read/health.js";
import type { LicenseProbe } from "../../src/types.js";

const licResponse = (result: string, type = "Logical") =>
  `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
 <BODY><DESC><CMPINFO><COMPANY>0</COMPANY></CMPINFO></DESC>
  <DATA><RESULT TYPE="${type}">${result}</RESULT></DATA>
 </BODY>
</ENVELOPE>`;

describe("buildLicenseInfoEnvelope", () => {
  it("targets the $$LicenseInfo function with the requested PARAM", () => {
    const xml = buildLicenseInfoEnvelope("IsEducationalMode");
    expect(xml).toContain("<TYPE>Function</TYPE>");
    expect(xml).toContain("<ID>$$LicenseInfo</ID>");
    expect(xml).toContain("<PARAM>IsEducationalMode</PARAM>");
    expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
  });
});

describe("parseLicenseInfoResult", () => {
  it("extracts the RESULT scalar even with a TYPE attribute", () => {
    expect(parseLicenseInfoResult(licResponse("No"))).toBe("No");
    expect(parseLicenseInfoResult(licResponse("784409490", "Number"))).toBe("784409490");
    expect(parseLicenseInfoResult(licResponse("arjun@zosma.ai", "String"))).toBe(
      "arjun@zosma.ai",
    );
  });

  it("returns undefined when there is no RESULT (unsupported param)", () => {
    const err = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DESC/></BODY></ENVELOPE>`;
    expect(parseLicenseInfoResult(err)).toBeUndefined();
  });

  it("returns undefined for an empty RESULT", () => {
    expect(parseLicenseInfoResult(licResponse(""))).toBeUndefined();
  });
});

describe("parseTallyLogical", () => {
  it("maps Yes/No (any case) to booleans", () => {
    expect(parseTallyLogical("Yes")).toBe(true);
    expect(parseTallyLogical("no")).toBe(false);
    expect(parseTallyLogical("YES")).toBe(true);
  });
  it("returns undefined for unknown/absent values", () => {
    expect(parseTallyLogical(undefined)).toBeUndefined();
    expect(parseTallyLogical("maybe")).toBeUndefined();
  });
});

describe("deriveEdition (regression: never infer from company names)", () => {
  const probe = (p: Partial<LicenseProbe>): LicenseProbe => ({ supported: true, ...p });

  it("reports Silver for a genuine Silver license, even with an 'EDUCATIONAL' company loaded", () => {
    // This is the exact real-world case: license is Silver, but a company is
    // literally named "PHOENIX EDUCATIONAL INSTITUTE PRIVATE LIMITED".
    const license = probe({
      isEducationalMode: false,
      isSilver: true,
      isGold: false,
      serialNumber: "784409490",
    });
    expect(deriveEdition(license)).toBe("Silver");
  });

  it("reports Educational ONLY when $$LicenseInfo:IsEducationalMode is Yes", () => {
    expect(deriveEdition(probe({ isEducationalMode: true }))).toBe("Educational");
  });

  it("reports Gold when IsGold is Yes", () => {
    expect(deriveEdition(probe({ isGold: true }))).toBe("Gold");
  });

  it("reports Licensed when not educational but edition flags are unknown", () => {
    expect(deriveEdition(probe({ isEducationalMode: false }))).toBe("Licensed");
  });

  it("reports Unknown when Tally did not answer the probe", () => {
    expect(deriveEdition({ supported: false })).toBe("Unknown");
  });
});
