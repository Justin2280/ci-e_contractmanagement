import { describe, expect, it } from "vitest";
import { isoWeekEnd, isoWeekStart, parseWeekLabel, weekLabelToEndDate } from "@/lib/weeks";

describe("weeks", () => {
  it("parses the labels used in planning mails", () => {
    expect(parseWeekLabel("2027-12")).toEqual({ jaar: 2027, week: 12 });
    expect(parseWeekLabel("2026-44")).toEqual({ jaar: 2026, week: 44 });
    expect(parseWeekLabel("2027-W12")).toEqual({ jaar: 2027, week: 12 });
    expect(parseWeekLabel("week 12 2027")).toEqual({ jaar: 2027, week: 12 });
    expect(parseWeekLabel("wk 44-2026")).toEqual({ jaar: 2026, week: 44 });
    expect(parseWeekLabel("12/2027")).toEqual({ jaar: 2027, week: 12 });
    expect(parseWeekLabel("2027-60")).toBeNull();
    expect(parseWeekLabel("")).toBeNull();
    expect(parseWeekLabel("maart 2027")).toBeNull();
  });

  it("maps ISO weeks to Monday and Sunday", () => {
    expect(isoWeekStart({ jaar: 2027, week: 12 })).toBe("2027-03-22");
    expect(isoWeekEnd({ jaar: 2027, week: 12 })).toBe("2027-03-28");
    expect(isoWeekEnd({ jaar: 2026, week: 44 })).toBe("2026-11-01");
    expect(isoWeekEnd({ jaar: 2026, week: 1 })).toBe("2026-01-04");
    expect(isoWeekEnd({ jaar: 2027, week: 1 })).toBe("2027-01-10");
  });

  it("converts labels straight to an end date", () => {
    expect(weekLabelToEndDate("2027-12")).toBe("2027-03-28");
    expect(weekLabelToEndDate(null)).toBeNull();
  });
});
