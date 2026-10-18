// SVG path data for computed curves and pieces, in mm user units (ADR 0004). The caller chooses
// the `viewBox` and draws the grainline from `piece.grainline`.

import type { ComputedCurve, ComputedPiece } from "./types";
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
