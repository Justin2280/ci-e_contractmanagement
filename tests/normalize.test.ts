import { describe, expect, it } from "vitest";
import { normalizePersonName, personMatchKey, normalizeCompanyName, normalizeContractNumber } from "@/lib/normalize";

describe("normalize", () => {
  it("normalises person names from different sources", () => {
    expect(normalizePersonName("Dhr. W.S. Terpstra")).toBe("terpstra ws");
    expect(normalizePersonName("Dhr W.S. Terpstra ")).toBe("terpstra ws");
    expect(personMatchKey("Walter Terpstra")).toBe("terpstra w");
    expect(personMatchKey("Dhr. W.S. Terpstra")).toBe("terpstra w");
    expect(personMatchKey("Epker, A. (Andre)")).toBe("epker a");
    expect(personMatchKey("Dhr A. Epker ")).toBe("epker a");
    expect(personMatchKey("Fisseha Semere")).toBe("semere f");
    expect(personMatchKey("Dhr S. Fisseha ")).toBe("fisseha s");
    expect(personMatchKey("Dhr. K.J. van Dulst")).toBe("dulst k");
    expect(personMatchKey("Michel Storm")).toBe("storm m");
  });

  it("normalises company names and contract numbers", () => {
    expect(normalizeCompanyName("Boskalis Nederland B.V.")).toBe("boskalis nederland");
    expect(normalizeCompanyName("GelreGroen Construction V.O.F.")).toBe("gelregroen construction");
    expect(normalizeContractNumber(" VHB-RAM-2022-005 NOVK -004 ")).toBe("VHB-RAM-2022-005NOVK-004");
  });
});
