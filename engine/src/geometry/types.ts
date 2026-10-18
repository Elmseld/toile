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

/** A pattern piece: an outline of curves that closes by point name, and a grainline. */
export type PieceDefinition = {
  name: string;
  outline: OutlineEntry[];
  grainline: { from: string; to: string };
};

/** A validated, normalised pattern definition (defaults filled in). */
export type PatternDefinition = {
  version: 1;
  name?: string;
  source?: string;
  measurements: string[];
  parameters: Record<string, number>;
  formulas: Record<string, string>;
  points: PointDefinition[];
  curves: CurveDefinition[];
  pieces: PieceDefinition[];
};

/** What a definition is evaluated against. */
export type PatternInput = {
  /** A measurement profile; names the definition does not declare are ignored. */
  measurements: Readonly<Record<string, number>>;
  /** Overrides of declared parameter defaults. */
  parameters?: Readonly<Record<string, number>>;
};

export type ComputedCurve =
  | { name: string; type: "line"; from: Point; to: Point; length: number }
  | { name: string; type: "cubic"; from: Point; c1: Point; c2: Point; to: Point; length: number };

export type ComputedPiece = {
  name: string;
  outline: ComputedCurve[];
  grainline: { from: Point; to: Point };
};

/** Everything that computed, in declaration order, also when other parts failed. */
export type ComputedPattern = {
  /** Measurements, parameters and formulas that evaluated. */
  values: Record<string, number>;
  /** Final positions, user offsets included. */
  points: Record<string, Point>;
  curves: Record<string, ComputedCurve>;
  pieces: Record<string, ComputedPiece>;
};

export type PatternResult =
  | (ComputedPattern & { ok: true })
  | (ComputedPattern & { ok: false; errors: PatternError[] });

/** Which section of the definition an element is declared in. */
export type ElementSource = "measurement" | "parameter" | "formula" | "point" | "curve" | "piece";

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
  | { kind: "open_outline"; name: string; field: string; message: string };

/**
 * Every error `evaluatePattern` returns. Structural errors have a JSON-pointer `path`; the others
 * have `name` (the element), an optional `field` inside it and, where it applies, a `span` into
 * that field's string.
 */
export type PatternError = DefinitionError | ElementError;
