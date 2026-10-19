import { describe, expect, test } from "bun:test";
import { formatDisplay, fromDisplay, MAX_PARAMETER, toDisplay } from "./index";

describe("toDisplay and formatDisplay", () => {
  test("show lengths in cm with up to two decimals", () => {
    expect(formatDisplay(toDisplay(12.5, "length"), ",")).toBe("1,25");
    expect(formatDisplay(toDisplay(40, "length"), ",")).toBe("4");
    expect(formatDisplay(toDisplay(45, "length"), ".")).toBe("4.5");
    expect(toDisplay(-0.01, "length")).toBe(0);
  });

  test("show angles as they are and angles per length per cm", () => {
    expect(toDisplay(20, "angle")).toBe(20);
    expect(formatDisplay(toDisplay(0.12, "angle_per_length"), ",")).toBe("1,2");
    expect(toDisplay(0.125, "angle_per_length")).toBe(1.25);
    expect(toDisplay(3, "number")).toBe(3);
  });
});

describe("fromDisplay", () => {
  test("reads cm with either separator", () => {
    expect(fromDisplay("4,5", "length")).toBe(45);
    expect(fromDisplay(" 4.5 ", "length")).toBe(45);
    expect(fromDisplay("1,25", "length")).toBe(12.5);
    expect(fromDisplay("-2", "length")).toBe(-20);
    expect(fromDisplay(",5", "length")).toBe(5);
    expect(fromDisplay("4.", "length")).toBe(40);
    expect(fromDisplay("1,234", "length")).toBe(12.3);
  });

  test("reads angles and angles per cm", () => {
    expect(fromDisplay("22,5", "angle")).toBe(22.5);
    expect(fromDisplay("1,2", "angle_per_length")).toBe(0.12);
    expect(fromDisplay("1,25", "angle_per_length")).toBe(0.125);
    expect(fromDisplay("7", "number")).toBe(7);
  });

  test("round-trips stored values", () => {
    for (const [value, unit] of [
      [12.5, "length"],
      [0.12, "angle_per_length"],
      [20, "angle"],
      [140, "length"],
    ] as const) {
      expect(fromDisplay(formatDisplay(toDisplay(value, unit), ","), unit)).toBe(value);
    }
  });

  test("bad input is null", () => {
    for (const text of ["", " ", "abc", "4,5,1", "1e3", "4 5", "--1", ",", "Infinity", "0x10"]) {
      expect(fromDisplay(text, "length")).toBeNull();
    }
    expect(fromDisplay(String(MAX_PARAMETER / 10 + 1), "length")).toBeNull();
    expect(fromDisplay(String(MAX_PARAMETER), "number")).toBe(MAX_PARAMETER);
  });

  test("an unknown unit counts as a plain number", () => {
    expect(fromDisplay("4,5", "other" as never)).toBe(4.5);
    expect(toDisplay(4.5, "other" as never)).toBe(4.5);
  });
});
