import { describe, expect, test } from "bun:test";
import { compileProject, evaluateProject, type ProjectInput } from "./project";
import type { PatternError, PatternResult } from "./types";

type Json = Record<string, unknown>;

/** A part with a measurement `m`, a parameter `ease` and a formula `size = m + ease`. */
const source = (name = "base"): Json => ({
  name,
  definition: {
    version: 1,
    measurements: ["m"],
    parameters: { ease: 10 },
    formulas: { size: "m + ease" },
  },
});

/** A part that imports `size` from `from` and doubles it. */
const importer = (name: string, from: string, value = "size"): Json => ({
  name,
  definition: {
    version: 1,
    imports: { outer: `${from}.${value}` },
    formulas: { double: "outer * 2" },
  },
});

const INPUT: ProjectInput = { measurements: { m: 100 } };

function errorsOf(result: PatternResult | undefined): PatternError[] {
  if (result === undefined) throw new Error("part missing");
  return result.ok ? [] : result.errors;
}

describe("evaluateProject", () => {
  test("an import is fed from the other part's values, whatever the order of the parts", () => {
    for (const parts of [
      [source(), importer("sleeve", "base")],
      [importer("sleeve", "base"), source()],
    ]) {
      const result = evaluateProject(parts, INPUT);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.parts.sleeve?.values).toEqual({ outer: 110, double: 220 });
      // The result keeps the given order.
      expect(Object.keys(result.parts)).toEqual(parts.map((part) => String(part.name)));
    }
  });

  test("a chain of three parts in reverse order resolves", () => {
    const third = {
      name: "third",
      definition: { version: 1, imports: { d: "sleeve.double" }, formulas: { e: "d + 1" } },
    };
    const result = evaluateProject([third, importer("sleeve", "base"), source()], INPUT);
    expect(result.ok).toBe(true);
    expect(result.parts.third?.values.e).toBe(221);
  });

  test("parameter overrides are per part", () => {
    const result = evaluateProject([source(), importer("sleeve", "base")], {
      measurements: { m: 100 },
      parameters: { base: { ease: 20 }, unknown_part: { ease: 1 } },
    });
    expect(result.parts.base?.values.size).toBe(120);
    expect(result.parts.sleeve?.values.double).toBe(240);
    const stray = evaluateProject([source(), importer("sleeve", "base")], {
      measurements: { m: 100 },
      parameters: { sleeve: { ease: 5 } },
    });
    expect(stray.ok).toBe(false);
    expect(errorsOf(stray.parts.sleeve)).toEqual([
      expect.objectContaining({ kind: "unknown_parameter", name: "ease" }),
    ]);
  });

  const expectMissingImport = (result: ReturnType<typeof evaluateProject>, reference: string) => {
    expect(result.ok).toBe(false);
    expect(errorsOf(result.parts.sleeve)).toEqual([
      { kind: "missing_import", name: "outer", reference, message: expect.any(String) },
      expect.objectContaining({ kind: "failed_dependency", name: "double", dependency: "outer" }),
    ]);
  };

  test("an unknown source part is missing_import", () => {
    expectMissingImport(evaluateProject([source(), importer("sleeve", "bodice")], INPUT), "bodice.size");
  });

  test("a value the source part does not have is missing_import", () => {
    expectMissingImport(
      evaluateProject([source(), importer("sleeve", "base", "nope")], INPUT),
      "base.nope",
    );
  });

  test("a source part with errors is missing_import, even for a value that computed", () => {
    const failing = {
      name: "base",
      definition: { version: 1, measurements: ["m", "other"], formulas: { size: "m" } },
    };
    const result = evaluateProject([failing, importer("sleeve", "base")], INPUT);
    expect(result.parts.base?.values.size).toBe(100);
    expectMissingImport(result, "base.size");
  });

  test("a source part with an invalid definition is missing_import and keeps its errors", () => {
    const invalid = { name: "base", definition: { version: 2 } };
    const result = evaluateProject([invalid, importer("sleeve", "base")], INPUT);
    expect(errorsOf(result.parts.base)).toEqual([
      expect.objectContaining({ kind: "unsupported_version" }),
    ]);
    expectMissingImport(result, "base.size");
  });

  test("a cycle of two parts, and a part importing from itself, give missing_import", () => {
    const cycle = evaluateProject([importer("a", "b", "double"), importer("b", "a", "double")], INPUT);
    expect(cycle.ok).toBe(false);
    // Evaluated in the given order: a first (b has no values yet), then b (a failed).
    for (const name of ["a", "b"]) {
      expect(errorsOf(cycle.parts[name])[0]).toMatchObject({ kind: "missing_import", name: "outer" });
    }
    const self = evaluateProject([source(), importer("sleeve", "sleeve", "double")], INPUT);
    expectMissingImport(self, "sleeve.double");
    expect(self.parts.base?.ok).toBe(true);
  });

  test("a part after a cycle still resolves from a part outside it", () => {
    const result = evaluateProject(
      [importer("a", "b", "double"), importer("b", "a", "double"), importer("sleeve", "base"), source()],
      INPUT,
    );
    expect(result.parts.sleeve?.ok).toBe(true);
  });

  test("a repeated part name is duplicate_part and the repeat is skipped", () => {
    const result = evaluateProject([source(), importer("sleeve", "base"), source()], INPUT);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { kind: "duplicate_part", name: "base", index: 2, message: expect.any(String) },
    ]);
    expect(Object.keys(result.parts)).toEqual(["base", "sleeve"]);
    expect(result.parts.sleeve?.ok).toBe(true);
  });

  test("parts that are not an array, or entries without a string name, are invalid_project", () => {
    for (const parts of [null, undefined, 5, "parts", {}, { 0: source() }]) {
      const result = evaluateProject(parts, INPUT);
      expect(result).toEqual({
        ok: false,
        parts: {},
        errors: [{ kind: "invalid_project", message: expect.any(String) }],
      });
    }
    const result = evaluateProject([null, 3, { definition: {} }, { name: 5 }, source()], INPUT);
    expect(result.errors.map((error) => [error.kind, "index" in error ? error.index : null])).toEqual([
      ["invalid_project", 0],
      ["invalid_project", 1],
      ["invalid_project", 2],
      ["invalid_project", 3],
    ]);
    expect(result.parts.base?.ok).toBe(true);
    expect(result.ok).toBe(false);
  });

  test("an empty project is ok", () => {
    expect(evaluateProject([], INPUT)).toEqual({ ok: true, parts: {}, errors: [] });
  });

  test("hostile parts and inputs never throw", () => {
    const hostile = [
      {
        get name(): never {
          throw new Error("boom");
        },
      },
    ];
    expect(() => evaluateProject(hostile, INPUT)).not.toThrow();
    expect(evaluateProject(hostile, INPUT).errors).toEqual([
      { kind: "invalid_project", message: expect.any(String) },
    ]);
    const proxy = new Proxy([], { get: () => { throw new Error("boom"); } });
    expect(() => evaluateProject(proxy, INPUT)).not.toThrow();
    const hostileInput = {
      get measurements(): never {
        throw new Error("boom");
      },
    };
    for (const input of [hostileInput, null, undefined, 5, { measurements: null, parameters: "x" }]) {
      const result = evaluateProject([source()], input as unknown as ProjectInput);
      expect(errorsOf(result.parts.base)[0]).toMatchObject({ kind: "missing_measurement", name: "m" });
    }
  });

  test("part names such as __proto__ are stored as own data", () => {
    const result = evaluateProject([source("__proto__"), importer("sleeve", "__proto__")], INPUT);
    expect(Object.hasOwn(result.parts, "__proto__")).toBe(true);
    expect(result.parts.sleeve?.values.double).toBe(220);
  });
});

describe("compileProject", () => {
  test("compile once, evaluate with several inputs; results share no objects", () => {
    const parts = [source(), importer("sleeve", "base")];
    const compiled = compileProject(parts);
    const a = compiled.evaluate({ measurements: { m: 100 } });
    const b = compiled.evaluate({ measurements: { m: 200 } });
    expect(a.parts.sleeve?.values.double).toBe(220);
    expect(b.parts.sleeve?.values.double).toBe(420);
    expect(compiled.evaluate({ measurements: { m: 100 } })).toEqual(a);
    expect(a.parts.base).not.toBe(compiled.evaluate({ measurements: { m: 100 } }).parts.base);
    expect(evaluateProject(parts, { measurements: { m: 200 } })).toEqual(b);
  });

  test("project errors are fresh copies on every evaluation", () => {
    const compiled = compileProject([source(), source()]);
    const first = compiled.evaluate(INPUT);
    (first.errors[0] as { message: string }).message = "changed";
    expect(compiled.evaluate(INPUT).errors[0]?.message).not.toBe("changed");
  });

  test("the parts are not read after compiling", () => {
    const parts = [source(), importer("sleeve", "base")];
    const compiled = compileProject(parts);
    parts.pop();
    (parts[0]!.definition as Json).formulas = { size: "1" };
    expect(compiled.evaluate(INPUT).parts.sleeve?.values.double).toBe(220);
  });
});
