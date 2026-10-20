// Places the parts of a project side by side (ADR 0007): layout is geometry, so the engine computes
// it and a view only applies the offsets, e.g. as an SVG `translate`.

import type { Bounds } from "./svg";

/** The horizontal gap (mm) between neighbouring parts. */
export const PART_GAP = 50;

/** Where `layoutParts` puts each part, and the box around all of them after moving. */
export type PartsLayout = {
  /** One offset per part, in the given order, to add to the part's coordinates. */
  offsets: { dx: number; dy: number }[];
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
  const offsets: { dx: number; dy: number }[] = [];
  let union: Bounds | null = null;
  for (const box of bounds) {
    if (box === null) {
      offsets.push({ dx: 0, dy: 0 });
      continue;
    }
    const dx: number = union === null ? 0 : union.maxX + gap - box.minX;
    const dy: number = union === null ? 0 : union.minY - box.minY;
    offsets.push({ dx, dy });
    const moved: Bounds = {
      minX: box.minX + dx,
      minY: box.minY + dy,
      maxX: box.maxX + dx,
      maxY: box.maxY + dy,
    };
    union =
      union === null
        ? moved
        : {
            minX: Math.min(union.minX, moved.minX),
            minY: Math.min(union.minY, moved.minY),
            maxX: Math.max(union.maxX, moved.maxX),
            maxY: Math.max(union.maxY, moved.maxY),
          };
  }
  return { offsets, bounds: union };
}
