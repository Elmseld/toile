import { describe, expect, test } from "bun:test";
import { FUNCTIONS, type FunctionSpec, type FunctionTable } from "./functions";

function call(name: string, ...args: number[]): number {
  const spec = FUNCTIONS.get(name);
  if (spec === undefined) throw new Error(`missing function ${name}`);
  if (spec.takes === "names") throw new Error(`${name} takes names`);
  return spec.apply(args);
}

describe("FUNCTIONS", () => {
  test("every built-in function takes numbers", () => {
    expect([...FUNCTIONS.values()].filter((spec) => spec.takes === "names")).toEqual([]);
  });

  test("contains exactly the documented functions", () => {
    expect([...FUNCTIONS.keys()].sort()).toEqual(
      ["abs", "acos", "asin", "atan2", "cos", "deg", "max", "min", "rad", "sin", "sqrt", "tan"],
    );
  });

  test("arities", () => {
    expect(FUNCTIONS.get("sqrt")).toMatchObject({ min: 1, max: 1 });
    expect(FUNCTIONS.get("min")).toMatchObject({ min: 1, max: null });
    expect(FUNCTIONS.get("max")).toMatchObject({ min: 1, max: null });
    expect(FUNCTIONS.get("atan2")).toMatchObject({ min: 2, max: 2 });
  });

  test("basic maths", () => {
    expect(call("sqrt", 16)).toBe(4);
    expect(call("min", 3, 1, 2)).toBe(1);
    expect(call("max", 2)).toBe(2);
    expect(call("max", 2, 7, 3)).toBe(7);
    expect(call("abs", -3)).toBe(3);
    expect(call("min", 0, -0)).toBe(-0);
    expect(call("max", -0, 0)).toBe(0);
  });

  test("trigonometry works in degrees", () => {
    expect(call("sin", 30)).toBeCloseTo(0.5, 10);
    expect(call("cos", 60)).toBeCloseTo(0.5, 10);
    expect(call("tan", 45)).toBeCloseTo(1, 10);
    expect(call("asin", 0.5)).toBeCloseTo(30, 10);
    expect(call("acos", 0.5)).toBeCloseTo(60, 10);
    expect(call("atan2", 1, 1)).toBeCloseTo(45, 10);
    expect(call("atan2", 1, -1)).toBeCloseTo(135, 10);
  });

  test("rad and deg convert", () => {
    expect(call("rad", 180)).toBeCloseTo(Math.PI, 10);
    expect(call("deg", Math.PI)).toBeCloseTo(180, 10);
  });

  test("rad and deg stay finite when the converted value is representable", () => {
    expect(call("rad", 1e308)).toBeCloseTo((Math.PI / 180) * 1e308, -300);
    expect(Number.isFinite(call("rad", 1e308))).toBe(true);
    expect(Number.isFinite(call("deg", 1e306))).toBe(true);
    expect(call("deg", 1e306) / 1e306).toBeCloseTo(180 / Math.PI, 10);
  });

  test("names are not looked up on the prototype", () => {
    expect(FUNCTIONS.get("constructor")).toBeUndefined();
    expect(FUNCTIONS.get("__proto__")).toBeUndefined();
    expect(FUNCTIONS.get("toString")).toBeUndefined();
  });

  test("cannot be mutated, so built-ins stay unchanged for every caller", () => {
    const names = [...FUNCTIONS.keys()];
    const sqrt = FUNCTIONS.get("sqrt");
    const mutable = FUNCTIONS as unknown as Map<string, FunctionSpec>;

    expect(Object.isFrozen(FUNCTIONS)).toBe(true);
    expect("set" in FUNCTIONS).toBe(false);
    expect("delete" in FUNCTIONS).toBe(false);
    expect("clear" in FUNCTIONS).toBe(false);
    expect(() => mutable.set("sqrt", { min: 0, max: 0, apply: () => 42 })).toThrow(TypeError);
    expect(() => mutable.delete("sqrt")).toThrow(TypeError);
    expect(() => mutable.clear()).toThrow(TypeError);
    expect(() => Map.prototype.set.call(mutable, "sqrt", sqrt)).toThrow(TypeError);
    expect(() => {
      (FUNCTIONS as { get: unknown }).get = () => undefined;
    }).toThrow(TypeError);

    expect(Object.isFrozen(sqrt)).toBe(true);
    expect(() => {
      (sqrt as { min: number }).min = 0;
    }).toThrow(TypeError);
    expect(() => {
      (sqrt as { apply: unknown }).apply = () => 42;
    }).toThrow(TypeError);

    expect([...FUNCTIONS.keys()]).toEqual(names);
    expect(FUNCTIONS.get("sqrt")).toBe(sqrt);
    expect(call("sqrt", 16)).toBe(4);
  });

  test("reads like a Map and extends by copying", () => {
    expect(FUNCTIONS.size).toBe(12);
    expect(FUNCTIONS.has("sqrt")).toBe(true);
    expect(FUNCTIONS.has("set")).toBe(false);
    expect([...FUNCTIONS.values()]).toHaveLength(12);
    expect([...FUNCTIONS.entries()].map(([name]) => name)).toEqual([...FUNCTIONS.keys()]);
    const seen: string[] = [];
    FUNCTIONS.forEach((_spec, name, table) => {
      expect(table).toBe(FUNCTIONS);
      seen.push(name);
    });
    expect(seen).toEqual([...FUNCTIONS.keys()]);

    const twice: FunctionSpec = { min: 1, max: 1, apply: (args) => 2 * (args[0] ?? Number.NaN) };
    const extended: FunctionTable = new Map<string, FunctionSpec>([...FUNCTIONS, ["twice", twice]]);
    expect(extended.size).toBe(13);
    expect(extended.get("twice")).toBe(twice);
    expect(extended.get("sqrt")).toBe(FUNCTIONS.get("sqrt"));
    expect(new Map(FUNCTIONS).size).toBe(12);
    expect(FUNCTIONS.has("twice")).toBe(false);
  });
});
