// Notches (balance marks) on a computed piece outline (ADR 0004 decision 17): the point at an arc
// distance along the outline, and the short marks a view draws there into the piece; also the same
// marks moved out to a cutting line (ADR 0011 decision 6).

import { cubicAt, cubicParameterAtLength, cubicTangent } from "./bezier";
import { outlinePolygon } from "./label";
import type { ComputedCurve, ComputedNotch, NotchMark } from "./types";
import { type Point, raySegmentHit } from "./vector";

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

/** Ray hits this far (mm) behind the start still count, for a cutting line through the outline. */
const HIT_TOLERANCE = 1e-9;

/**
 * The notches moved out to the cutting line `line` (a closed polygon such as `cuttingLine`'s
 * points, last point not repeated), in the order of `notches`. Each mark is moved along its own
 * line, outwards (against its inward direction), to where it first meets `line`, and keeps
 * `NOTCH_LENGTH`, pointing inward; the notch `point` moves the same way along the first mark's
 * direction. With an allowance of 0 the marks stay where they are. A mark (or point) whose ray
 * meets no segment of `line`, or that has no direction, is kept unchanged. Pure; never throws.
 */
export function cuttingLineNotches(
  notches: readonly ComputedNotch[],
  line: readonly Point[],
): ComputedNotch[] {
  return notches.map((notch) => {
    const [first] = notch.marks;
    const direction = first === undefined ? null : inwardUnit(first);
    const point = direction === null ? notch.point : moveOut(notch.point, direction, line);
    const marks = notch.marks.map((mark): NotchMark => {
      const inward = inwardUnit(mark);
      if (inward === null) return mark;
      const from = moveOut(mark.from, inward, line);
      return {
        from,
        to: { x: from.x + inward.x * NOTCH_LENGTH, y: from.y + inward.y * NOTCH_LENGTH },
      };
    });
    return { point, marks };
  });
}

/** The unit direction of `mark`, from the outline into the piece, or `null` when it has none. */
function inwardUnit(mark: NotchMark): Point | null {
  const dx = mark.to.x - mark.from.x;
  const dy = mark.to.y - mark.from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return { x: dx / length, y: dy / length };
}

/** `start` moved against `inward` to the nearest point of the closed polygon `line`. */
function moveOut(start: Point, inward: Point, line: readonly Point[]): Point {
  const outward = { x: -inward.x, y: -inward.y };
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length && line.length >= 2; i++) {
    const t = raySegmentHit(start, outward, line[i]!, line[(i + 1) % line.length]!);
    if (t !== null && t >= -HIT_TOLERANCE && t < nearest) nearest = t;
  }
  if (!Number.isFinite(nearest)) return start;
  return { x: start.x + outward.x * nearest, y: start.y + outward.y * nearest };
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
  // A unit tangent, or none where every control point coincides (reported by computeNotch).
  const tangent = cubicTangent(from, c1, c2, to, t) ?? { x: 0, y: 0 };
  return { point: cubicAt(from, c1, c2, to, t), tangent };
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
