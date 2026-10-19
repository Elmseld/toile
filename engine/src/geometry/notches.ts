// Notches (balance marks) on a computed piece outline (ADR 0004 decision 17): the point at an arc
// distance along the outline, and the short marks a view draws there into the piece.

import { cubicAt, cubicParameterAtLength, cubicTangent } from "./bezier";
import { outlinePolygon } from "./label";
import type { ComputedCurve, ComputedNotch, NotchMark } from "./types";
import type { Point } from "./vector";

/** The length (mm) of a notch mark, from the outline into the piece. */
export const NOTCH_LENGTH = 6;
/** The distance (mm) between the two marks of a double notch, along the outline. */
export const NOTCH_PAIR_SPACING = 4;

/** One notch to place: the outline index its walk starts at, the distance and the mark count. */
export type NotchSpec = { start: number; distance: number; marks: 1 | 2 };

/**
 * The notch `spec` on `outline`, or an English message saying why it cannot be placed.
 *
 * The notch lies `spec.distance` mm along the outline, walking forward in outline order from the
 * start of entry `spec.start` and on into the following entries, cyclically. A distance exactly at
 * a junction belongs to the following curve, and curves of zero length are skipped. The distance
 * must be finite and in `[0, outline length)`. Each mark is `NOTCH_LENGTH` long, perpendicular to
 * the outline and pointing into the piece; which side is inside follows from the orientation of
 * the outline polygon (its signed area). A double notch has two marks `NOTCH_PAIR_SPACING` apart
 * along the tangent, centred on the point.
 */
export function computeNotch(
  outline: readonly ComputedCurve[],
  spec: NotchSpec,
): ComputedNotch | string {
  const perimeter = outline.reduce((total, curve) => total + curve.length, 0);
  if (!(Number.isFinite(spec.distance) && spec.distance >= 0 && spec.distance < perimeter)) {
    return `The notch distance must be a finite number from 0 to below the outline length (${perimeter} mm)`;
  }
  const located = locate(outline, spec.start, spec.distance);
  const length = Math.hypot(located.tangent.x, located.tangent.y);
  if (!(length > 0)) return "The outline has no direction at the notch";
  const along = { x: located.tangent.x / length, y: located.tangent.y / length };
  // With y down, a positive signed area is a clockwise outline on screen, whose inside lies to
  // the right of the direction of travel: (-y, x).
  const sign = signedArea(outlinePolygon({ outline, grainline: GRAINLINE_UNUSED })) >= 0 ? 1 : -1;
  const inward = { x: -along.y * sign, y: along.x * sign };
  const offsets = spec.marks === 2 ? [-NOTCH_PAIR_SPACING / 2, NOTCH_PAIR_SPACING / 2] : [0];
  const marks: NotchMark[] = offsets.map((offset) => {
    const from = { x: located.point.x + along.x * offset, y: located.point.y + along.y * offset };
    return {
      from,
      to: { x: from.x + inward.x * NOTCH_LENGTH, y: from.y + inward.y * NOTCH_LENGTH },
    };
  });
  return { point: located.point, marks };
}

const GRAINLINE_UNUSED = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };

/** The point and direction of travel `distance` mm along the outline from entry `start`. */
function locate(
  outline: readonly ComputedCurve[],
  start: number,
  distance: number,
): { point: Point; tangent: Point } {
  let remaining = distance;
  for (let step = 0; step < outline.length; step++) {
    const curve = outline[(start + step) % outline.length]!;
    if (curve.length === 0) continue;
    if (remaining < curve.length) return within(curve, remaining);
    remaining -= curve.length;
  }
  // Only reached when rounding in the sums above leaves the distance a hair beyond the last
  // curve; the walk has then come round to where it started.
  return within(firstWithLength(outline, start), 0);
}

function firstWithLength(outline: readonly ComputedCurve[], start: number): ComputedCurve {
  for (let step = 0; step < outline.length; step++) {
    const curve = outline[(start + step) % outline.length]!;
    if (curve.length > 0) return curve;
  }
  // Unreachable: a positive distance below the perimeter means some curve has a length.
  return outline[start]!;
}

/** The point and direction of travel `distance` mm (below its length) along one curve. */
function within(curve: ComputedCurve, distance: number): { point: Point; tangent: Point } {
  if (curve.type === "line") {
    const t = distance / curve.length;
    const tangent = { x: curve.to.x - curve.from.x, y: curve.to.y - curve.from.y };
    return { point: { x: curve.from.x + tangent.x * t, y: curve.from.y + tangent.y * t }, tangent };
  }
  const { from, c1, c2, to } = curve;
  const t = cubicParameterAtLength(from, c1, c2, to, distance);
  return { point: cubicAt(from, c1, c2, to, t), tangent: cubicTangent(from, c1, c2, to, t) };
}

/** The signed area of a closed polygon; positive when it runs clockwise on screen (y down). */
function signedArea(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}
