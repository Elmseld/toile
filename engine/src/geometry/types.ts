// Types of the pattern definition format (version 1, ADR 0004), of the computed geometry and of
// the errors `evaluatePattern` returns. Types only.

import type {
  DuplicateNameError,
  FormulaError,
  InvalidNameError,
  Span,
} from "../formula/errors";
import type { Point } from "./vector";

/** A user's manual adjustment of a point, in mm, added after its operation is computed. */
export type UserOffset = { dx: number; dy: number };

type PointBase = { name: string; user_offset?: UserOffset };

/**
 * A point: an operation on other points (name fields) and formulas (formula fields, ADR 0003).
 * Field order is also the order of the point's dependency edges.
 */
export type PointDefinition = PointBase &
  (
    | { op: "start"; x: string; y: string }
    | { op: "offset"; from: string; dx: string; dy: string }
    | { op: "along_line"; from: string; to: string; distance: string }
    | { op: "along_angle"; from: string; angle: string; distance: string }
    | { op: "perpendicular"; from: string; to: string; distance: string }
    | { op: "line_intersection"; line1: [string, string]; line2: [string, string] }
    | {
        op: "line_circle_intersection";
        line: [string, string];
        center: string;
        radius: string;
        which: "first" | "second";
      }
    | { op: "midpoint"; from: string; to: string }
  );

/** The name of a point operation. */
export type PointOp = PointDefinition["op"];

/** A curve between named points; the control points of a cubic are named points too. */
export type CurveDefinition =
  | { name: string; type: "line"; from: string; to: string }
  | { name: string; type: "cubic"; from: string; c1: string; c2: string; to: string };

/**
 * One edge of a piece outline: the curve it follows, in the curve's own direction. An object
 * rather than a bare name so later versions can add per-edge data (reversed, seam allowance, fold)
 * as optional fields without changing the shape.
 */
export type OutlineEntry = { curve: string };

/**
 * A balance mark on a piece outline (ADR 0004 decision 17): it lies `distance` mm (a formula)
 * along the outline, walking forward in outline order from the start of `curve`, which must be a
 * curve of the outline. `marks` is 1 (a single notch, the default) or 2 (a double notch, by
 * convention at the back).
 */
export type NotchDefinition = { curve: string; distance: string; marks: 1 | 2 };

/**
 * A pattern piece: an outline of curves that closes by point name, a grainline and its notches
 * (`[]` when the definition has none).
 */
export type PieceDefinition = {
  name: string;
  outline: OutlineEntry[];
  grainline: { from: string; to: string };
  notches: NotchDefinition[];
};

/** A validated, normalised pattern definition (defaults filled in). */
export type PatternDefinition = {
  version: 1;
  name?: string;
  source?: string;
  measurements: string[];
  /**
   * Values taken from another part of the same project, `{ local name: "<part>.<value>" }` (ADR
   * 0007). The local name is a value in the definition's namespace, like a measurement.
   */
  imports: Record<string, string>;
  parameters: Record<string, number>;
  formulas: Record<string, string>;
  points: PointDefinition[];
  curves: CurveDefinition[];
  pieces: PieceDefinition[];
};

/** Options of one evaluation of a compiled pattern. */
export type EvaluateOptions = {
  /**
   * User offsets by point name that replace the definition's `user_offset` for this evaluation,
   * e.g. while a point is dragged; `null` means no offset. Names that are not points are ignored.
   */
  offsets?: Readonly<Record<string, UserOffset | null>>;
};

/** A definition prepared by `compilePattern`, to be evaluated against any number of inputs. */
export type CompiledPattern = {
  /**
   * The same result as `evaluatePattern(definition, input)` (with `options.offsets` applied).
   * Never throws.
   */
  readonly evaluate: (input: PatternInput, options?: EvaluateOptions) => PatternResult;
};

/** What a definition is evaluated against. */
export type PatternInput = {
  /** A measurement profile; names the definition does not declare are ignored. */
  measurements: Readonly<Record<string, number>>;
  /** Overrides of declared parameter defaults. */
  parameters?: Readonly<Record<string, number>>;
  /**
   * Values of the declared imports, by local name; names the definition does not import are
   * ignored. `evaluateProject` fills them from the other parts.
   */
  imports?: Readonly<Record<string, number>>;
};

/** A computed position in a result; results share these objects, so they are read-only. */
type ResultPoint = Readonly<Point>;

export type ComputedCurve =
  | {
      readonly name: string;
      readonly type: "line";
      readonly from: ResultPoint;
      readonly to: ResultPoint;
      readonly length: number;
    }
  | {
      readonly name: string;
      readonly type: "cubic";
      readonly from: ResultPoint;
      readonly c1: ResultPoint;
      readonly c2: ResultPoint;
      readonly to: ResultPoint;
      readonly length: number;
    };

/** One straight mark of a notch, from the outline into the piece. */
export type NotchMark = { readonly from: ResultPoint; readonly to: ResultPoint };

/**
 * A computed notch: its position on the outline and its marks, each `NOTCH_LENGTH` mm into the
 * piece; a double notch has two marks `NOTCH_PAIR_SPACING` mm apart, centred on the point.
 */
export type ComputedNotch = { readonly point: ResultPoint; readonly marks: readonly NotchMark[] };

export type ComputedPiece = {
  readonly name: string;
  readonly outline: readonly ComputedCurve[];
  readonly grainline: { readonly from: ResultPoint; readonly to: ResultPoint };
  /** In definition order; empty when the piece has none. */
  readonly notches: readonly ComputedNotch[];
};

/**
 * Everything that computed, in declaration order, also when other parts failed. Read-only: within
 * one result the same point and curve objects appear in several places (`points`, `basePoints`,
 * `curves`, `pieces`). Results never share objects with each other or with a compiled pattern.
 */
export type ComputedPattern = {
  /** Measurements, parameters and formulas that evaluated. */
  readonly values: Readonly<Record<string, number>>;
  /** Final positions, user offsets included. */
  readonly points: Readonly<Record<string, ResultPoint>>;
  /**
   * Positions before the user offset (the operation's result), for every point in `points`, and
   * also for a point whose operation computed but whose offset position is out of bounds. The
   * editor turns a pointer position `p` into the offset `p - basePoints[name]`.
   */
  readonly basePoints: Readonly<Record<string, ResultPoint>>;
  readonly curves: Readonly<Record<string, ComputedCurve>>;
  readonly pieces: Readonly<Record<string, ComputedPiece>>;
};

export type PatternResult =
  | (ComputedPattern & { ok: true })
  | (ComputedPattern & { ok: false; errors: PatternError[] });

/** Which section of the definition an element is declared in. */
export type ElementSource =
  | "measurement"
  | "import"
  | "parameter"
  | "formula"
  | "point"
  | "curve"
  | "piece";

/** What a reference must name: a number, a point, a curve or a piece. */
export type ReferenceKind = "value" | "point" | "curve" | "piece";

/** A structural problem: the definition does not have the version 1 shape. */
export type DefinitionError =
  | { kind: "invalid_definition"; path: string; message: string }
  | { kind: "unsupported_version"; path: "/version"; version: number; message: string };

/** Where inside a point, curve or piece an error is: `distance`, `line1/0`, `outline/2/curve`. */
type Located = { field?: string };

/** An error that belongs to a named element of the definition. */
export type ElementError =
  | (Exclude<FormulaError, { kind: "invalid_name" | "duplicate_name" }> & Located)
  | InvalidNameError<ElementSource>
  | DuplicateNameError<ElementSource>
  | { kind: "missing_measurement"; name: string; message: string }
  | { kind: "missing_import"; name: string; reference: string; message: string }
  | { kind: "invalid_value"; name: string; source: "import"; message: string }
  | { kind: "unknown_parameter"; name: string; message: string }
  | {
      kind: "wrong_reference_kind";
      name: string;
      field?: string;
      reference: string;
      expected: ReferenceKind;
      actual: ReferenceKind;
      span: Span;
      message: string;
    }
  | { kind: "degenerate_geometry"; name: string; field?: string; message: string }
  | { kind: "no_intersection"; name: string; message: string }
  | { kind: "open_outline"; name: string; field: string; message: string }
  | { kind: "invalid_notch"; name: string; field: string; message: string };

/**
 * Every error `evaluatePattern` returns. Structural errors have a JSON-pointer `path`; the others
 * have `name` (the element), an optional `field` inside it and, where it applies, a `span` into
 * that field's string.
 */
export type PatternError = DefinitionError | ElementError;
