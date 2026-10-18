// Structural validation of pattern definitions (format version 1, ADR 0004). Checks the shape
// only; names, references and geometry are checked by `evaluatePattern`.

import { CURVE_FIELDS, type FieldKind, OP_FIELDS } from "./operations";
import type {
  CurveDefinition,
  DefinitionError,
  OutlineEntry,
  PatternDefinition,
  PieceDefinition,
  PointDefinition,
} from "./types";

/** The only definition format version this engine reads. */
export const PATTERN_FORMAT_VERSION = 1;

/**
 * The most entries one section (`measurements`, `parameters`, `formulas`, `points`, `curves`,
 * `pieces`) may have. Far above any garment (a block has a few hundred points), but it bounds the
 * work an untrusted definition can cause.
 */
export const MAX_SECTION_ENTRIES = 20_000;

/**
 * The most entries the outline of one piece may have. All outlines together may have at most
 * `MAX_SECTION_ENTRIES`.
 */
export const MAX_OUTLINE_ENTRIES = 1_000;

export type ValidationResult =
  | { ok: true; definition: PatternDefinition }
  | { ok: false; errors: DefinitionError[] };

const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  "version",
  "name",
  "source",
  "measurements",
  "parameters",
  "formulas",
  "points",
  "curves",
  "pieces",
]);

type JsonObject = Readonly<Record<string, unknown>>;

/**
 * Checks that `value` has the shape of a version 1 pattern definition and returns a normalised
 * deep copy: missing collections become empty, and every array and object is freshly built from
 * own enumerable data, so later code never reads (or mutates) the caller's object.
 *
 * Never throws. Every structural problem is reported at once as `invalid_definition` with a JSON
 * pointer `path` (`""` is the root, `/points/3/distnce` an unknown field). A `version` other than
 * `1` is a single `unsupported_version` error (path `/version`) and nothing else is checked.
 * Unknown fields, formulas that are not strings and arrays with empty slots are rejected, and so
 * are sections with more than `MAX_SECTION_ENTRIES` entries, outlines with more than
 * `MAX_OUTLINE_ENTRIES` and pieces whose outlines have more than `MAX_SECTION_ENTRIES` entries in
 * total (at `/pieces`; the items are then not checked). An object that throws while being
 * read (a hostile getter or proxy) is reported as `invalid_definition` at the root.
 */
export function validateDefinition(value: unknown): ValidationResult {
  try {
    return new Validator().definition(value);
  } catch {
    return {
      ok: false,
      errors: [invalidDefinition("", "The definition could not be read as plain data")],
    };
  }
}

class Validator {
  private readonly errors: DefinitionError[] = [];
  /** Outline entries counted so far across all pieces. */
  private outlineEntries = 0;

  definition(value: unknown): ValidationResult {
    if (!isObject(value)) {
      return { ok: false, errors: [invalidDefinition("", "The definition must be a JSON object")] };
    }

    if (!Object.hasOwn(value, "version")) {
      this.problem("/version", 'Missing required field "version"');
    } else if (typeof value.version !== "number") {
      this.problem("/version", '"version" must be a number');
    } else if (value.version !== PATTERN_FORMAT_VERSION) {
      return {
        ok: false,
        errors: [
          {
            kind: "unsupported_version",
            path: "/version",
            version: value.version,
            message: `Unsupported definition version ${value.version} (this engine reads version ${PATTERN_FORMAT_VERSION})`,
          },
        ],
      };
    }

    this.unknownFields(value, "", TOP_LEVEL_FIELDS);
    const name = this.optionalString(value, "name", "");
    const source = this.optionalString(value, "source", "");
    const measurements = this.list(value, "measurements", (item, path) =>
      this.string(item, path, "must be a measurement name (a string)"),
    );
    const parameters = this.record(value, "parameters", (item, path) =>
      typeof item === "number" ? item : this.problem(path, "must be a number"),
    );
    const formulas = this.record(value, "formulas", (item, path) =>
      this.string(item, path, 'must be a formula string (write "50", not 50)'),
    );
    const points = this.list(value, "points", (item, path) => this.point(item, path));
    const curves = this.list(value, "curves", (item, path) => this.curve(item, path));
    const pieces = this.list(value, "pieces", (item, path) => this.piece(item, path));

    if (this.errors.length > 0) return { ok: false, errors: this.errors };
    return {
      ok: true,
      definition: {
        version: PATTERN_FORMAT_VERSION,
        ...(name === undefined ? {} : { name }),
        ...(source === undefined ? {} : { source }),
        measurements,
        parameters,
        formulas,
        points,
        curves,
        pieces,
      },
    };
  }

  private point(value: unknown, path: string): PointDefinition | undefined {
    if (!isObject(value)) return this.problem(path, "A point must be an object");
    const name = this.requiredString(value, "name", path, "must be a point name (a string)");
    const op = this.requiredString(value, "op", path, "must be a string");
    const fields = op === undefined ? undefined : OP_FIELDS.get(op);
    if (op !== undefined && fields === undefined) {
      this.problem(`${path}/op`, `Unknown point operation "${op}"`);
    }

    const point: Record<string, unknown> = { name, op };
    if (fields !== undefined) {
      const allowed = new Set(["name", "op", "user_offset", ...fields.map(([field]) => field)]);
      this.unknownFields(value, path, allowed);
      for (const [field, kind] of fields) point[field] = this.pointField(value, field, kind, path);
    }
    if (Object.hasOwn(value, "user_offset")) {
      point.user_offset = this.userOffset(value.user_offset, `${path}/user_offset`);
    }
    // Only used when no error was found, in which case every field above has the right type.
    return point as PointDefinition;
  }

  private pointField(value: JsonObject, field: string, kind: FieldKind, path: string): unknown {
    const fieldPath = `${path}/${field}`;
    if (!Object.hasOwn(value, field)) {
      return this.problem(fieldPath, `Missing required field "${field}"`);
    }
    const item = value[field];
    switch (kind) {
      case "name":
        return this.string(item, fieldPath, "must be a point name (a string)");
      case "formula":
        return this.string(item, fieldPath, 'must be a formula string (write "50", not 50)');
      case "which":
        return item === "first" || item === "second"
          ? item
          : this.problem(fieldPath, 'must be "first" or "second"');
      case "line": {
        if (!Array.isArray(item) || item.length !== 2) {
          return this.problem(fieldPath, "must be a list of exactly two point names");
        }
        const elements: readonly unknown[] = item;
        return [0, 1].map((i) =>
          this.string(elements[i], `${fieldPath}/${i}`, "must be a point name (a string)"),
        );
      }
    }
  }

  private userOffset(value: unknown, path: string): unknown {
    if (!isObject(value)) return this.problem(path, "must be an object { dx, dy }");
    this.unknownFields(value, path, new Set(["dx", "dy"]));
    const offset: Record<string, number | undefined> = {};
    for (const key of ["dx", "dy"]) {
      const item = Object.hasOwn(value, key) ? value[key] : undefined;
      offset[key] =
        typeof item === "number" && Number.isFinite(item)
          ? item
          : this.problem(`${path}/${key}`, "must be a finite number of millimetres");
    }
    return { dx: offset.dx, dy: offset.dy };
  }

  private curve(value: unknown, path: string): CurveDefinition | undefined {
    if (!isObject(value)) return this.problem(path, "A curve must be an object");
    const name = this.requiredString(value, "name", path, "must be a curve name (a string)");
    const type = this.requiredString(value, "type", path, "must be a string");
    const fields = type === undefined ? undefined : CURVE_FIELDS.get(type);
    if (type !== undefined && fields === undefined) {
      this.problem(`${path}/type`, `Unknown curve type "${type}" (use "line" or "cubic")`);
    }

    const curve: Record<string, unknown> = { name, type };
    if (fields !== undefined) {
      this.unknownFields(value, path, new Set(["name", "type", ...fields]));
      for (const field of fields) {
        curve[field] = this.requiredString(value, field, path, "must be a point name (a string)");
      }
    }
    return curve as CurveDefinition;
  }

  private piece(value: unknown, path: string): PieceDefinition | undefined {
    if (!isObject(value)) return this.problem(path, "A piece must be an object");
    this.unknownFields(value, path, new Set(["name", "outline", "grainline"]));
    const name = this.requiredString(value, "name", path, "must be a piece name (a string)");

    let outline: OutlineEntry[] | undefined;
    if (!Object.hasOwn(value, "outline")) {
      this.problem(`${path}/outline`, 'Missing required field "outline"');
    } else if (this.withinOutlineTotal(value.outline)) {
      outline = this.array(
        value.outline,
        `${path}/outline`,
        MAX_OUTLINE_ENTRIES,
        (item, itemPath) => this.outlineEntry(item, itemPath),
      );
      // `outline` only holds the valid entries, so emptiness is judged on the input.
      if (Array.isArray(value.outline) && value.outline.length === 0) {
        this.problem(`${path}/outline`, "must list at least one curve");
      }
    }

    let grainline: { from: string | undefined; to: string | undefined } | undefined;
    const grainPath = `${path}/grainline`;
    if (!Object.hasOwn(value, "grainline")) {
      this.problem(grainPath, 'Missing required field "grainline"');
    } else if (!isObject(value.grainline)) {
      this.problem(grainPath, "must be an object { from, to }");
    } else {
      const line = value.grainline;
      this.unknownFields(line, grainPath, new Set(["from", "to"]));
      grainline = {
        from: this.requiredString(line, "from", grainPath, "must be a point name (a string)"),
        to: this.requiredString(line, "to", grainPath, "must be a point name (a string)"),
      };
    }
    return { name, outline, grainline } as PieceDefinition;
  }

  /**
   * Adds the entries of one outline to the total of all pieces and reports, once, at `/pieces`
   * when that goes over `MAX_SECTION_ENTRIES`; from then on outlines are not checked, which bounds
   * the work of many large outlines. Anything `array` rejects on its own (not an array, more than
   * `MAX_OUTLINE_ENTRIES`) is not counted.
   */
  private withinOutlineTotal(outline: unknown): boolean {
    if (!Array.isArray(outline) || outline.length > MAX_OUTLINE_ENTRIES) return true;
    const before = this.outlineEntries;
    this.outlineEntries += outline.length;
    if (this.outlineEntries <= MAX_SECTION_ENTRIES) return true;
    if (before <= MAX_SECTION_ENTRIES) {
      this.problem(
        "/pieces",
        `The outlines must have at most ${MAX_SECTION_ENTRIES} entries in total`,
      );
    }
    return false;
  }

  private outlineEntry(value: unknown, path: string): OutlineEntry | undefined {
    if (!isObject(value)) return this.problem(path, "An outline entry must be an object { curve }");
    this.unknownFields(value, path, new Set(["curve"]));
    const curve = this.requiredString(value, "curve", path, "must be a curve name (a string)");
    return curve === undefined ? undefined : { curve };
  }

  /** An optional top-level array; each item is checked by `item`, which reports its problems. */
  private list<T>(
    value: JsonObject,
    key: string,
    item: (value: unknown, path: string) => T | undefined,
  ): T[] {
    if (!Object.hasOwn(value, key)) return [];
    return this.array(value[key], `/${key}`, MAX_SECTION_ENTRIES, item) ?? [];
  }

  /** An array of at most `max` items; each item is checked by `item`. */
  private array<T>(
    value: unknown,
    path: string,
    max: number,
    item: (value: unknown, path: string) => T | undefined,
  ): T[] | undefined {
    if (!Array.isArray(value)) return this.problem(path, "must be an array");
    const items: readonly unknown[] = value;
    if (items.length > max) return this.problem(path, `must have at most ${max} items`);
    // A sparse array (only from a JavaScript caller) could claim a huge length; checking the own
    // keys first keeps the loop below linear in the data actually present.
    if (Object.keys(items).length < items.length) {
      return this.problem(path, "must not have empty slots");
    }
    const result: T[] = [];
    for (let i = 0; i < items.length; i++) {
      const checked = item(items[i], `${path}/${i}`);
      if (checked !== undefined) result.push(checked);
    }
    return result;
  }

  /**
   * An optional top-level `{ name: value }` object, rebuilt with `fromEntries` (safe for
   * `__proto__`).
   */
  private record<T>(
    value: JsonObject,
    key: string,
    item: (value: unknown, path: string) => T | undefined,
  ): Record<string, T> {
    if (!Object.hasOwn(value, key)) return {};
    const record = value[key];
    if (!isObject(record)) {
      this.problem(`/${key}`, "must be an object");
      return {};
    }
    const keys = Object.keys(record);
    if (keys.length > MAX_SECTION_ENTRIES) {
      this.problem(`/${key}`, `must have at most ${MAX_SECTION_ENTRIES} entries`);
      return {};
    }
    const entries: [string, T][] = [];
    for (const [name, entry] of Object.entries(record)) {
      const checked = item(entry, `/${key}/${escapePointer(name)}`);
      if (checked !== undefined) entries.push([name, checked]);
    }
    return Object.fromEntries(entries);
  }

  private optionalString(value: JsonObject, key: string, path: string): string | undefined {
    if (!Object.hasOwn(value, key)) return undefined;
    return this.string(value[key], `${path}/${key}`, "must be a string");
  }

  private requiredString(
    value: JsonObject,
    key: string,
    path: string,
    message: string,
  ): string | undefined {
    if (!Object.hasOwn(value, key)) {
      return this.problem(`${path}/${key}`, `Missing required field "${key}"`);
    }
    return this.string(value[key], `${path}/${key}`, message);
  }

  private string(value: unknown, path: string, message: string): string | undefined {
    return typeof value === "string" ? value : this.problem(path, message);
  }

  private unknownFields(value: JsonObject, path: string, allowed: ReadonlySet<string>): void {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        this.problem(`${path}/${escapePointer(key)}`, `Unknown field "${key}"`);
      }
    }
  }

  private problem(path: string, message: string): undefined {
    this.errors.push(invalidDefinition(path, message));
    return undefined;
  }
}

function invalidDefinition(path: string, message: string): DefinitionError {
  return { kind: "invalid_definition", path, message };
}

/** A plain object (not `null`, not an array). */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Escapes one JSON pointer segment (RFC 6901): `~` as `~0`, `/` as `~1`. */
function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
