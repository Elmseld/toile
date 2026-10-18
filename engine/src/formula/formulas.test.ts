import { describe, expect, test } from "bun:test";
import { type FormulaInput, evaluateFormulas } from "./formulas";
import { MAX_FORMULA_LENGTH } from "./parser";

function input(partial: Partial<FormulaInput>): FormulaInput {
  return Object.freeze({
    measurements: Object.freeze({ ...partial.measurements }),
    parameters: Object.freeze({ ...partial.parameters }),
    formulas: Object.freeze({ ...partial.formulas }),
  });
}

describe("evaluateFormulas", () => {
  test("measurements, parameters and formulas", () => {
    expect(
      evaluateFormulas(
        input({
          measurements: { waist: 720 },
          parameters: { ease_waist: 10 },
          formulas: { front_waist: "waist / 4 + ease_waist" },
        }),
      ),
    ).toEqual({ ok: true, values: { waist: 720, ease_waist: 10, front_waist: 190 } });
  });

  test("an empty input is ok", () => {
    expect(evaluateFormulas(input({}))).toEqual({ ok: true, values: {} });
  });

  test("dependencies are evaluated first, whatever the declaration order", () => {
    const measurements = { waist: 720 };
    const forward = evaluateFormulas(
      input({ measurements, formulas: { c: "b * 2", b: "a + 1", a: "waist / 4" } }),
    );
    const reversed = evaluateFormulas(
      input({ measurements, formulas: { a: "waist / 4", b: "a + 1", c: "b * 2" } }),
    );
    expect(forward).toEqual({ ok: true, values: { waist: 720, c: 362, b: 181, a: 180 } });
    expect(reversed.ok).toBe(true);
    expect(reversed.values).toEqual(forward.values);
  });

  test("values are in declaration order", () => {
    const result = evaluateFormulas(
      input({ measurements: { m: 1 }, parameters: { p: 2 }, formulas: { z: "y", y: "p + m" } }),
    );
    expect(Object.keys(result.values)).toEqual(["m", "p", "z", "y"]);
  });

  test("a long chain of formulas is evaluated without deep recursion", () => {
    const count = 10_000;
    const formulas: Record<string, string> = {};
    for (let i = 0; i < count - 1; i++) formulas[`f${i}`] = `f${i + 1} + 1`;
    formulas[`f${count - 1}`] = "1";
    const result = evaluateFormulas(input({ formulas }));
    expect(result.ok).toBe(true);
    expect(result.values.f0).toBe(count);
  });

  test("a long cycle is reported whole without deep recursion", () => {
    const count = 10_000;
    const formulas: Record<string, string> = {};
    for (let i = 0; i < count; i++) formulas[`f${i}`] = `f${(i + 1) % count} + 1`;
    const result = evaluateFormulas(input({ formulas }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ kind: "circular_dependency", name: "f0" });
      if (result.errors[0]?.kind === "circular_dependency") {
        expect(result.errors[0].cycle).toHaveLength(count + 1);
      }
    }
  });

  test("many cycles through a long chain stay fast", () => {
    // Every formula references the next one and the first, so a naive search finds one long
    // cycle per formula (quadratic in total). One group gives one error.
    const count = 10_000;
    const formulas: Record<string, string> = { f0: "f1" };
    for (let i = 1; i < count - 1; i++) formulas[`f${i}`] = `f${i + 1} + f0`;
    formulas[`f${count - 1}`] = "f0";
    const started = performance.now();
    const result = evaluateFormulas(input({ formulas }));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((e) => e.kind === "circular_dependency")).toEqual([
        expect.objectContaining({ cycle: ["f0", "f1", "f0"] }),
      ]);
      expect(result.errors).toHaveLength(count - 1);
    }
  });

  describe("circular dependencies", () => {
    test("a cycle is reported once, naming it", () => {
      const result = evaluateFormulas(
        input({ formulas: { a: "b + 1", b: "c * 2", c: "1 + a" } }),
      );
      expect(result).toEqual({
        ok: false,
        values: {},
        errors: [
          {
            kind: "circular_dependency",
            name: "a",
            cycle: ["a", "b", "c", "a"],
            span: { start: 0, end: 1 },
            message: "Circular dependency: a -> b -> c -> a",
          },
        ],
      });
    });

    test("the cycle starts at its first-declared member", () => {
      const result = evaluateFormulas(
        input({ formulas: { c: "1 + a", a: "b + 1", b: "c * 2" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
          kind: "circular_dependency",
          name: "c",
          cycle: ["c", "a", "b", "c"],
          span: { start: 4, end: 5 },
          message: "Circular dependency: c -> a -> b -> c",
        });
      }
    });

    test("self-reference", () => {
      expect(evaluateFormulas(input({ formulas: { a: "a + 1" } }))).toMatchObject({
        ok: false,
        errors: [{ kind: "circular_dependency", name: "a", cycle: ["a", "a"], span: { start: 0, end: 1 } }],
      });
    });

    test("dependants fail, unrelated formulas still evaluate", () => {
      const result = evaluateFormulas(
        input({
          measurements: { m: 4 },
          formulas: { d: "2 * a", a: "b", b: "a", ok: "m * 2" },
        }),
      );
      expect(result).toEqual({
        ok: false,
        values: { m: 4, ok: 8 },
        errors: [
          {
            kind: "failed_dependency",
            name: "d",
            dependency: "a",
            span: { start: 4, end: 5 },
            message: '"d" depends on "a", which has an error',
          },
          {
            kind: "circular_dependency",
            name: "a",
            cycle: ["a", "b", "a"],
            span: { start: 0, end: 1 },
            message: "Circular dependency: a -> b -> a",
          },
        ],
      });
    });

    test("formulas that share a group of cycles get one cycle error, the others a failed dependency", () => {
      const result = evaluateFormulas(input({ formulas: { a: "b", b: "a + c", c: "b" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          expect.objectContaining({ kind: "circular_dependency", name: "a", cycle: ["a", "b", "a"] }),
          expect.objectContaining({ kind: "failed_dependency", name: "c", dependency: "b" }),
        ]);
      }
    });

    test("two separate cycles are both reported", () => {
      const result = evaluateFormulas(input({ formulas: { a: "b", b: "a", x: "x" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => e.kind === "circular_dependency" && e.cycle)).toEqual([
          ["a", "b", "a"],
          ["x", "x"],
        ]);
      }
    });
  });

  describe("unknown references", () => {
    test("carry the formula name, the reference and its span", () => {
      expect(
        evaluateFormulas(input({ measurements: { waist: 720 }, formulas: { front: "wiast / 4" } })),
      ).toEqual({
        ok: false,
        values: { waist: 720 },
        errors: [
          {
            kind: "unknown_reference",
            name: "front",
            reference: "wiast",
            span: { start: 0, end: 5 },
            message: 'Unknown name "wiast"',
          },
        ],
      });
    });

    test("every unknown name in a formula is reported", () => {
      const result = evaluateFormulas(input({ formulas: { f: "x + y + x" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          expect.objectContaining({ kind: "unknown_reference", name: "f", reference: "x", span: { start: 0, end: 1 } }),
          expect.objectContaining({ kind: "unknown_reference", name: "f", reference: "y", span: { start: 4, end: 5 } }),
        ]);
      }
    });

    test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
      "prototype member %p is unknown",
      (name) => {
        expect(evaluateFormulas(input({ formulas: { f: name } }))).toMatchObject({
          ok: false,
          errors: [{ kind: "unknown_reference", name: "f", reference: name }],
        });
      },
    );
  });

  test("a measurement named __proto__ works", () => {
    const measurements: Record<string, number> = {};
    Object.defineProperty(measurements, "__proto__", {
      value: 3,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const result = evaluateFormulas(input({ measurements, formulas: { f: "__proto__ * 2" } }));
    expect(result.ok).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.values, "__proto__")?.value).toBe(3);
    expect(result.values.f).toBe(6);
    expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype);
  });

  test("parse errors carry the formula name", () => {
    expect(evaluateFormulas(input({ formulas: { f: "2 +" } }))).toMatchObject({
      ok: false,
      errors: [{ kind: "syntax", name: "f", span: { start: 3, end: 3 } }],
    });
    expect(evaluateFormulas(input({ formulas: { f: "foo(1)" } }))).toMatchObject({
      ok: false,
      errors: [{ kind: "unknown_function", name: "f", function: "foo" }],
    });
  });

  test("evaluation errors carry the formula name", () => {
    const result = evaluateFormulas(
      input({ measurements: { m: 1 }, formulas: { a: "1 / (m - m)", b: "sqrt(-m)", c: "a + 1" } }),
    );
    expect(result).toMatchObject({
      ok: false,
      values: { m: 1 },
      errors: [
        { kind: "division_by_zero", name: "a", span: { start: 4, end: 11 } },
        { kind: "invalid_result", name: "b", function: "sqrt" },
        { kind: "failed_dependency", name: "c", dependency: "a" },
      ],
    });
  });

  test("formulas at the length limit evaluate, one character over is a syntax error", () => {
    const terms = MAX_FORMULA_LENGTH / 2 - 1;
    const atLimit = `${"a+".repeat(terms)}aa`;
    const overLimit = `${atLimit}a`;
    const result = evaluateFormulas(
      input({ measurements: { a: 1, aa: 2 }, formulas: { ok: atLimit, long: overLimit } }),
    );
    expect(result).toMatchObject({
      ok: false,
      values: { a: 1, aa: 2, ok: terms + 2 },
      errors: [{ kind: "syntax", name: "long", message: "Formula is too long" }],
    });
  });

  describe("input validation", () => {
    test("invalid names", () => {
      expect(
        evaluateFormulas(input({ measurements: { "my waist": 1 }, formulas: { "1abc": "1" } })),
      ).toMatchObject({
        ok: false,
        values: {},
        errors: [
          { kind: "invalid_name", name: "my waist", source: "measurement" },
          { kind: "invalid_name", name: "1abc", source: "formula" },
        ],
      });
    });

    test("non-finite measurement and parameter values", () => {
      const result = evaluateFormulas(
        input({
          measurements: { a: Number.NaN, ok: 1 },
          parameters: { b: Number.POSITIVE_INFINITY },
          formulas: { f: "a + ok" },
        }),
      );
      expect(result).toMatchObject({
        ok: false,
        values: { ok: 1 },
        errors: [
          { kind: "invalid_value", name: "a", source: "measurement" },
          { kind: "invalid_value", name: "b", source: "parameter" },
          { kind: "failed_dependency", name: "f", dependency: "a" },
        ],
      });
    });

    test("non-number values from untyped callers", () => {
      const measurements = { a: "12" } as unknown as Record<string, number>;
      const formulas = { f: 12 } as unknown as Record<string, string>;
      expect(evaluateFormulas(input({ measurements, formulas }))).toMatchObject({
        ok: false,
        errors: [
          { kind: "invalid_value", name: "a" },
          { kind: "syntax", name: "f", message: "Formula must be a string" },
        ],
      });
    });

    test("a name in more than one source", () => {
      const result = evaluateFormulas(
        input({
          measurements: { waist: 720 },
          parameters: { waist: 10 },
          formulas: { waist: "1", f: "waist + 1" },
        }),
      );
      expect(result).toEqual({
        ok: false,
        values: {},
        errors: [
          {
            kind: "duplicate_name",
            name: "waist",
            sources: ["measurement", "parameter", "formula"],
            message: '"waist" is declared more than once (measurement, parameter, formula)',
          },
          {
            kind: "failed_dependency",
            name: "f",
            dependency: "waist",
            span: { start: 0, end: 5 },
            message: '"f" depends on "waist", which has an error',
          },
        ],
      });
    });
  });

  test("errors are sorted by declaration order", () => {
    const result = evaluateFormulas(
      input({
        measurements: { m: Number.NaN },
        parameters: { p: 1 },
        formulas: { z: "q", y: "2 +", x: "p / 0" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.name)).toEqual(["m", "z", "y", "x"]);
  });

  test("the result is the same on repeated calls", () => {
    const data = input({ measurements: { m: 2 }, formulas: { a: "b", b: "m", c: "c" } });
    expect(evaluateFormulas(data)).toEqual(evaluateFormulas(data));
  });
});
