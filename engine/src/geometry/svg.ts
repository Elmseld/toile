// SVG path data for computed curves and pieces, in mm user units (ADR 0004). The caller chooses
// the `viewBox` and draws the grainline from `piece.grainline`.

import type { ComputedCurve, ComputedPattern, ComputedPiece } from "./types";
import type { Point } from "./vector";

/**
 * `value` rounded to 0.01 mm, without trailing zeros and never as `-0`. Values too large to round
 * that way (beyond about 1e306, never produced by `evaluatePattern`, which bounds coordinates) are
 * written unrounded, in exponent notation where needed. `NaN` and infinities, only possible in
 * hand-built input, give `"0"`, so the path data stays parseable.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  // `value * 100` overflows to Infinity for the largest finite numbers.
  if (!Number.isFinite(rounded)) return String(value);
  // `+ 0` turns -0 (from rounding a small negative number) into 0.
  return String(rounded + 0);
}

/**
 * `"M x y L x y"` for a line, `"M x y C x1 y1 x2 y2 x y"` for a cubic, `""` for a curve of any
 * other type (only possible in hand-built input).
 */
export function curvePathData(curve: ComputedCurve): string {
  const command = segment(curve);
  return command === null ? "" : `M ${coordinates(curve.from)} ${command}`;
}

/**
 * `"M"` at the start of the first curve, then one `L` or `C` per outline curve in order (the last
 * one back to the start included), then `"Z"`. Curves of another type (only in hand-built input)
 * are skipped; an empty outline gives `""`.
 */
export function piecePathData(piece: ComputedPiece): string {
  const [first] = piece.outline;
  if (first === undefined) return "";
  const parts = [`M ${coordinates(first.from)}`];
  for (const curve of piece.outline) {
    const command = segment(curve);
    if (command !== null) parts.push(command);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** An axis-aligned box in mm user units. */
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The box around every piece: the end and control points of each outline curve (a cubic lies
 * inside its control polygon, so the box always contains the drawn outline, sometimes with a little
 * room) and the grainline points. `null` when there are no pieces or no finite coordinate; a
 * non-finite number (only possible in hand-built input) is skipped, per axis. Callers use it to fit
 * the `viewBox` without doing geometry themselves.
 */
export function patternBounds(pattern: Pick<ComputedPattern, "pieces">): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (point: Point): void => {
    if (Number.isFinite(point.x)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
    }
    if (Number.isFinite(point.y)) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  };
  for (const piece of Object.values(pattern.pieces)) {
    for (const curve of piece.outline) {
      include(curve.from);
      if (curve.type === "cubic") {
        include(curve.c1);
        include(curve.c2);
      }
      include(curve.to);
    }
    include(piece.grainline.from);
    include(piece.grainline.to);
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
}

/** The drawing command of `curve` from its start point, or `null` for an unknown curve type. */
function segment(curve: ComputedCurve): string | null {
  switch (curve.type) {
    case "line":
      return `L ${coordinates(curve.to)}`;
    case "cubic":
      return `C ${coordinates(curve.c1)} ${coordinates(curve.c2)} ${coordinates(curve.to)}`;
    default:
      return null;
  }
}

function coordinates(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}
