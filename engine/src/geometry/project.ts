// Evaluates the parts of a pattern project together (ADR 0007): each part is a pattern
// definition, and a part's `imports` take values from the results of the other parts. Parts are
// evaluated in the order their imports need, so a sleeve is always computed from the bodice of the
// same evaluation.

import { compilePattern } from "./evaluate";
import type { CompiledPattern, PatternResult } from "./types";
import { validateDefinition } from "./validate";

/** One part of a project: its name (the part name imports refer to) and its definition. */
export type ProjectPart = { name: string; definition: unknown };

/** What a project is evaluated against. */
export type ProjectInput = {
  /** A measurement profile, shared by every part. */
  measurements: Readonly<Record<string, number>>;
  /** Parameter overrides by part name; overrides for names that are not parts are ignored. */
  parameters?: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/** A problem with the list of parts itself; such entries are left out of the result. */
export type ProjectError =
  | { kind: "invalid_project"; index?: number; message: string }
  | { kind: "duplicate_part"; name: string; index: number; message: string };

export type ProjectResult = {
  /** No project errors and every part evaluated without errors. */
  readonly ok: boolean;
  /** The result of every part, by name, in the given order (invalid parts with their errors). */
  readonly parts: Readonly<Record<string, PatternResult>>;
  readonly errors: readonly ProjectError[];
};

/** A project prepared by `compileProject`, to be evaluated against any number of inputs. */
export type CompiledProject = {
  /** The same result as `evaluateProject(parts, input)`. Never throws. */
  readonly evaluate: (input: ProjectInput) => ProjectResult;
};

type Part = {
  name: string;
  compiled: CompiledPattern;
  /** The part's imports as `[local name, source part, source value]`. */
  imports: readonly (readonly [string, string, string])[];
};

/**
 * Validates `parts` (untrusted: an array of `{ name, definition }`) and compiles every part once
 * (`compilePattern`). The returned `evaluate(input)` evaluates the parts in dependency order: a
 * part whose `imports` name another part comes after it, and each import is fed from that part's
 * result `values`. Parts in a cycle (a part importing from itself included) are evaluated last, in
 * the given order, with whatever values exist by then.
 *
 * An import whose part is not in the project, whose value the part's result does not have, or
 * whose part has errors stays unresolved, so the importing part reports `missing_import` for it
 * (and `failed_dependency` for what depends on it): a drawing or an error, never a wrong drawing.
 *
 * `parts` that is not an array is one `invalid_project` error; an entry that is not an object with
 * a string `name` is `invalid_project` with its `index`, a repeated name `duplicate_part`; such
 * entries are skipped. A part whose definition is invalid still appears in `parts`, with its
 * errors. Never throws; `parts` is not read again after this call.
 */
export function compileProject(parts: unknown): CompiledProject {
  const errors: ProjectError[] = [];
  const list = readParts(parts, errors);
  const order = evaluationOrder(list);
  return Object.freeze({
    evaluate: (input: ProjectInput): ProjectResult => evaluateParts(list, order, errors, input),
  });
}

/**
 * Evaluates the parts of a project against `input`; the same as
 * `compileProject(parts).evaluate(input)`. Compile once instead when evaluating the same parts
 * repeatedly.
 */
export function evaluateProject(parts: unknown, input: ProjectInput): ProjectResult {
  return compileProject(parts).evaluate(input);
}

function readParts(parts: unknown, errors: ProjectError[]): Part[] {
  const list: Part[] = [];
  try {
    if (!Array.isArray(parts)) {
      errors.push(invalidProject("The parts must be an array"));
      return list;
    }
    const entries: readonly unknown[] = parts;
    const names = new Set<string>();
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const name = typeof entry === "object" && entry !== null ? Reflect.get(entry, "name") : null;
      if (typeof name !== "string") {
        errors.push(invalidProject("A part must be an object with a string name", index));
        continue;
      }
      if (names.has(name)) {
        errors.push({
          kind: "duplicate_part",
          name,
          index,
          message: `The part name "${name}" is used more than once`,
        });
        continue;
      }
      names.add(name);
      list.push(compilePart(name, Reflect.get(entry as object, "definition")));
    }
  } catch {
    errors.length = 0;
    list.length = 0;
    errors.push(invalidProject("The parts could not be read as plain data"));
  }
  return list;
}

function compilePart(name: string, definition: unknown): Part {
  const validated = validateDefinition(definition);
  if (!validated.ok) return { name, compiled: compilePattern(definition), imports: [] };
  const imports = Object.entries(validated.definition.imports).map(([local, reference]) => {
    // Validation guarantees exactly one dot between two identifiers.
    const dot = reference.indexOf(".");
    return [local, reference.slice(0, dot), reference.slice(dot + 1)] as const;
  });
  // The validated copy is the caller's data rebuilt, so compiling it reads nothing of theirs.
  return { name, compiled: compilePattern(validated.definition), imports };
}

/**
 * Indexes into `parts` in evaluation order: repeatedly the first part (in the given order) whose
 * imported parts have all been placed, then the parts left in cycles, in the given order. Quadratic
 * in the number of parts, which is a handful.
 */
function evaluationOrder(parts: readonly Part[]): number[] {
  const names = new Set(parts.map((part) => part.name));
  const dependencies = parts.map(
    (part) => new Set(part.imports.map(([, source]) => source).filter((source) => names.has(source))),
  );
  const placed = new Set<string>();
  const order: number[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (placed.has(part.name)) continue;
      if ([...dependencies[i]!].every((source) => placed.has(source))) {
        placed.add(part.name);
        order.push(i);
        progress = true;
        break;
      }
    }
  }
  for (let i = 0; i < parts.length; i++) {
    if (!placed.has(parts[i]!.name)) order.push(i);
  }
  return order;
}

function evaluateParts(
  parts: readonly Part[],
  order: readonly number[],
  errors: readonly ProjectError[],
  input: ProjectInput,
): ProjectResult {
  // Read once, so a hostile getter cannot answer differently per part; values that are not numbers
  // are reported by the parts that declare them (`invalid_value`).
  const measurements = readRecord(input, "measurements") as Record<string, number>;
  const parameters = readRecord(input, "parameters");
  const results = new Map<string, PatternResult>();
  for (const index of order) {
    const part = parts[index]!;
    const imports: [string, number][] = [];
    for (const [local, source, value] of part.imports) {
      const result = results.get(source);
      if (result === undefined || !result.ok || !Object.hasOwn(result.values, value)) continue;
      imports.push([local, result.values[value]!]);
    }
    const overrides = (
      Object.hasOwn(parameters, part.name) ? readRecord(parameters, part.name) : {}
    ) as Record<string, number>;
    results.set(
      part.name,
      part.compiled.evaluate({
        measurements,
        parameters: overrides,
        imports: Object.fromEntries(imports),
      }),
    );
  }
  const ordered = Object.fromEntries(
    parts.map((part) => [part.name, results.get(part.name)!] as const),
  );
  return {
    ok: errors.length === 0 && Object.values(ordered).every((result) => result.ok),
    parts: ordered,
    errors: structuredClone(errors),
  };
}

/**
 * The own enumerable entries of `source[key]` as a fresh plain record; empty when either is not an
 * object or throws while being read (a hostile getter or proxy).
 */
function readRecord(source: unknown, key: string): Record<string, unknown> {
  try {
    if (typeof source !== "object" || source === null) return {};
    const record: unknown = Reflect.get(source, key);
    if (typeof record !== "object" || record === null) return {};
    return Object.fromEntries(Object.entries(record));
  } catch {
    return {};
  }
}

function invalidProject(message: string, index?: number): ProjectError {
  return { kind: "invalid_project", ...(index === undefined ? {} : { index }), message };
}
