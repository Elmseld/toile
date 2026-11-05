// Places the parts of a project side by side (ADR 0007), and the pieces of one part apart from
// each other (ADR 0011): layout is geometry, so the engine computes it and a view only applies the
// offsets, e.g. as an SVG `translate`.

import type { Bounds } from "./svg";
import type { ComputedCurve, ComputedPattern } from "./types";
import type { Point } from "./vector";

/** The horizontal gap (mm) between neighbouring parts. */
export const PART_GAP = 50;

/** The least room (mm) `layoutPieces` leaves between the boxes of two pieces of one part. */
export const PIECE_GAP = 20;

/** An offset to add to coordinates. */
export type Offset = { dx: number; dy: number };

/** Where `layoutParts` puts each part, and the box around all of them after moving. */
export type PartsLayout = {
  /** One offset per part, in the given order, to add to the part's coordinates. */
  offsets: Offset[];
  /** The union of the moved boxes, for fitting a view; `null` when no part has a box. */
  bounds: Bounds | null;
};

/**
 * Lays out parts given by their boxes (`patternBounds` of each part's result) left to right in
 * the given order: each part is moved so its left edge lies `gap` mm right of the parts before it,
 * and its top level with the first part's top. A part without a box (`null`: nothing computed)
 * gets `{ dx: 0, dy: 0 }` and takes no room. Pure and cheap: fine on every redraw.
 */
export function layoutParts(bounds: readonly (Bounds | null)[], gap = PART_GAP): PartsLayout {
  const offsets: Offset[] = [];
  let union: Bounds | null = null;
  for (const box of bounds) {
    if (box === null) {
      offsets.push({ dx: 0, dy: 0 });
      continue;
    }
    const dx: number = union === null ? 0 : union.maxX + gap - box.minX;
    const dy: number = union === null ? 0 : union.minY - box.minY;
    offsets.push({ dx, dy });
    union = unite(union, moveBox(box, dx, dy));
  }
  return { offsets, bounds: union };
}

/**
 * Moves the pieces of one part apart, given by their boxes (`patternBounds` of each piece with its
 * cutting line), so that no two boxes come closer than `gap` mm, while keeping the arrangement of
 * the definition where it already has the room. Pieces only move right (`dy` is always 0): they
 * are taken by the left edges of their boxes (ties in the given order), and each one moves just
 * far enough to lie `gap` right of every piece taken before it whose box, widened by `gap`,
 * overlaps its own vertically. So two pieces end up at least `gap` apart horizontally or
 * vertically, whatever the seam allowances; pieces with room enough stay where they are (`dx` 0).
 * A piece without a box (`null`) gets `{ dx: 0, dy: 0 }` and takes no room. Returns the offsets in
 * the given order and the union of the moved boxes (the part's box for `layoutParts`).
 */
export function layoutPieces(bounds: readonly (Bounds | null)[], gap = PIECE_GAP): PartsLayout {
  const offsets: Offset[] = bounds.map(() => ({ dx: 0, dy: 0 }));
  const order = bounds
    .map((box, index) => ({ box, index }))
    .filter((entry): entry is { box: Bounds; index: number } => entry.box !== null)
    .sort((a, b) => a.box.minX - b.box.minX || a.index - b.index);
  const placed: Bounds[] = [];
  let union: Bounds | null = null;
  for (const { box, index } of order) {
    let dx = 0;
    for (const other of placed) {
      if (other.minY < box.maxY + gap && box.minY < other.maxY + gap) {
        dx = Math.max(dx, other.maxX + gap - box.minX);
      }
    }
    offsets[index] = { dx, dy: 0 };
    const moved = moveBox(box, dx, 0);
    placed.push(moved);
    union = unite(union, moved);
  }
  return { offsets, bounds: union };
}

/**
 * The piece each point of `pattern` is drawn with, by point name, for a view that moves pieces
 * apart (`layoutPieces`): the first piece (in `pieces` order) whose outline curves or grainline
 * use the point, else (a construction point no piece uses) the piece whose outline box is nearest
 * to it, the first on a tie. Uses are found by identity: within one result a point object is shared
 * by `points` and the curves and pieces that use it. Points that are not finite, and every point
 * when no piece has a box, are left out.
 */
export function pointPieces(
  pattern: Pick<ComputedPattern, "points" | "pieces">,
): Map<string, string> {
  const users = new Map<Readonly<Point>, string>();
  const boxes: { name: string; box: Bounds }[] = [];
  for (const piece of Object.values(pattern.pieces)) {
    const own: Readonly<Point>[] = [piece.grainline.from, piece.grainline.to];
    for (const curve of piece.outline) own.push(...curvePoints(curve));
    for (const point of own) if (!users.has(point)) users.set(point, piece.name);
    const box = boxOf(own);
    if (box !== null) boxes.push({ name: piece.name, box });
  }
  const owners = new Map<string, string>();
  for (const [name, point] of Object.entries(pattern.points)) {
    const user = users.get(point);
    if (user !== undefined) {
      owners.set(name, user);
      continue;
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    let best: { name: string; distance: number } | null = null;
    for (const { name: piece, box } of boxes) {
      const distance = Math.hypot(
        Math.max(box.minX - point.x, 0, point.x - box.maxX),
        Math.max(box.minY - point.y, 0, point.y - box.maxY),
      );
      if (best === null || distance < best.distance) best = { name: piece, distance };
    }
    if (best !== null) owners.set(name, best.name);
  }
  return owners;
}

/** `curve` moved by `dx`, `dy` (a new curve; the name, type and length stay). */
export function shiftCurve(curve: ComputedCurve, dx: number, dy: number): ComputedCurve {
  const shift = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  if (curve.type === "cubic") {
    return {
      ...curve,
      from: shift(curve.from),
      c1: shift(curve.c1),
      c2: shift(curve.c2),
      to: shift(curve.to),
    };
  }
  return { ...curve, from: shift(curve.from), to: shift(curve.to) };
}

function curvePoints(curve: ComputedCurve): Readonly<Point>[] {
  return curve.type === "cubic"
    ? [curve.from, curve.c1, curve.c2, curve.to]
    : [curve.from, curve.to];
}

/** The box around the finite points of `points`, or `null` when there are none. */
function boxOf(points: readonly Readonly<Point>[]): Bounds | null {
  let box: Bounds | null = null;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    box = unite(box, { minX: x, minY: y, maxX: x, maxY: y });
  }
  return box;
}

function moveBox(box: Bounds, dx: number, dy: number): Bounds {
  return { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
}

function unite(a: Bounds | null, b: Bounds): Bounds {
  if (a === null) return b;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
