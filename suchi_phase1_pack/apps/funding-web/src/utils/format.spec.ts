import { describe, it, expect } from "vitest";
import { formatNumber, formatDate, formatDateShort } from "./format";

describe("formatNumber", () => {
  it("formats number with en-IN locale", () => {
    expect(formatNumber(1234)).toBe("1,234");
    // en-IN uses Indian numbering: 12,34,567.89
    expect(formatNumber(1234567.89)).toBe("12,34,567.89");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatDate", () => {
  it("formats Date with medium date and short time", () => {
    const d = new Date("2025-02-03T14:30:00Z");
    const out = formatDate(d);
    expect(out).toMatch(/2025|Feb|February/);
    expect(out).toMatch(/\d|:/);
  });

  it("formats ISO string", () => {
    const out = formatDate("2025-02-03T14:30:00.000Z");
    expect(out).toBeDefined();
    expect(out.length).toBeGreaterThan(5);
  });
});

describe("formatDateShort", () => {
  it("formats Date with medium date only", () => {
    const d = new Date("2025-02-03T14:30:00Z");
    const out = formatDateShort(d);
    expect(out).toMatch(/2025|Feb|February|03/);
  });

  it("formats string date", () => {
    const out = formatDateShort("2025-02-03");
    expect(out).toBeDefined();
  });
});
