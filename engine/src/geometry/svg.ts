// SVG path data for computed curves and pieces, in mm user units (ADR 0004). The caller chooses
// the `viewBox` and draws the grainline from `piece.grainline`.

import type { ComputedCurve, ComputedPiece } from "./types";
import type { Point } from "./vector";

/** `value` rounded to 0.01 mm, without trailing zeros and never as `-0`. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  // `+ 0` turns -0 (from rounding a small negative number) into 0.
  return String(rounded + 0);
}

/** `"M x y L x y"` for a line, `"M x y C x1 y1 x2 y2 x y"` for a cubic. */
export function curvePathData(curve: ComputedCurve): string {
  return `M ${coordinates(curve.from)} ${segment(curve)}`;
}

/**
 * `"M"` at the start of the first curve, then one `L` or `C` per outline curve in order (the last
 * one back to the start included), then `"Z"`.
 */
export function piecePathData(piece: ComputedPiece): string {
  const [first] = piece.outline;
  if (first === undefined) return "";
  const parts = [`M ${coordinates(first.from)}`];
  for (const curve of piece.outline) parts.push(segment(curve));
  parts.push("Z");
  return parts.join(" ");
}

/** The drawing command of `curve` from its start point. */
function segment(curve: ComputedCurve): string {
  return curve.type === "line"
    ? `L ${coordinates(curve.to)}`
    : `C ${coordinates(curve.c1)} ${coordinates(curve.c2)} ${coordinates(curve.to)}`;
}

function coordinates(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}
