import { describe, expect, it } from "vitest";
import { DEFAULT_HANDTEKENING, dagdeel, defaultStijlInstructies, effectieveStijl, metHandtekening } from "@/lib/llm/default-stijl";

describe("externe schrijfstijl van Justin", () => {
  it("falls back to the bundled style guide and signature when the settings are empty", () => {
    const s = effectieveStijl({ stijlInstructies: "", handtekening: "  " });
    expect(s.stijlInstructies).toContain("Bij voorbaat dank!");
    expect(s.stijlInstructies).toContain("Goedemorgen");
    expect(s.stijlInstructies).not.toContain("Kind regards");
    expect(s.handtekening).toBe(DEFAULT_HANDTEKENING);
    expect(DEFAULT_HANDTEKENING).toContain("Justin de Weert");
    expect(DEFAULT_HANDTEKENING).toContain("Manager Bedrijfsvoering");
    expect(DEFAULT_HANDTEKENING).not.toContain("Kind regards");
    expect(defaultStijlInstructies()).not.toMatch(/^## .*Handtekening/m);
  });

  it("keeps a saved custom style", () => {
    const s = effectieveStijl({ stijlInstructies: "Eigen stijl", handtekening: "Groet, J" });
    expect(s).toEqual({ stijlInstructies: "Eigen stijl", handtekening: "Groet, J" });
  });

  it("appends the signature once", () => {
    const body = "Goedemorgen Sandra,\n\nZou je dit willen verwerken?\n\nBij voorbaat dank!\n";
    const met = metHandtekening(body, DEFAULT_HANDTEKENING);
    expect(met).toBe(`Goedemorgen Sandra,\n\nZou je dit willen verwerken?\n\nBij voorbaat dank!\n\n${DEFAULT_HANDTEKENING}`);
    expect(metHandtekening(met, DEFAULT_HANDTEKENING)).toBe(met);
    expect(metHandtekening(body, "")).toBe(body.trimEnd());
  });

  it("picks the part of the day in Dutch time", () => {
    expect(dagdeel(new Date("2026-10-02T06:00:00Z"))).toBe("ochtend"); // 08:00 NL
    expect(dagdeel(new Date("2026-10-02T12:00:00Z"))).toBe("middag"); // 14:00 NL
    expect(dagdeel(new Date("2026-10-02T17:30:00Z"))).toBe("avond"); // 19:30 NL
  });
});
