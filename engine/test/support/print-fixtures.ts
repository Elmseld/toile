// Projects for the print tests (not part of the engine's API): the real blocks against a medium
// profile, and hand-built rectangles.

import { evaluatePattern } from "../../src/geometry/evaluate";
import { evaluateProject, type ProjectResult } from "../../src/geometry/project";
import type { ComputedPattern } from "../../src/geometry/types";
import { MEDIUM, readBlock } from "./blocks";

/** An ok project of the given blocks (part name = block name), for the medium profile. */
export function project(...blocks: string[]): ProjectResult {
  const result = evaluateProject(
    blocks.map((name) => ({ name, definition: readBlock(name) })),
    { measurements: MEDIUM },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}

const at = (name: string, x: number, y: number) => ({
  name,
  op: "start",
  x: String(x),
  y: String(y),
});
const line = (name: string, from: string, to: string) => ({ name, type: "line", from, to });

/**
 * A computed pattern with one rectangular piece per entry: `[name, x, y, width, height]` (mm).
 * The outline runs top, right, bottom, left from the top left corner; the grainline is vertical
 * through the middle.
 */
export function rectangles(
  ...entries: [string, number, number, number, number][]
): ComputedPattern {
  const points = entries.flatMap(([name, x, y, w, h]) => [
    at(`${name}_tl`, x, y),
    at(`${name}_tr`, x + w, y),
    at(`${name}_br`, x + w, y + h),
    at(`${name}_bl`, x, y + h),
    at(`${name}_gt`, x + w / 2, y + h / 4),
    at(`${name}_gb`, x + w / 2, y + (3 * h) / 4),
  ]);
  const curves = entries.flatMap(([name]) => [
    line(`${name}_top`, `${name}_tl`, `${name}_tr`),
    line(`${name}_right`, `${name}_tr`, `${name}_br`),
    line(`${name}_bottom`, `${name}_br`, `${name}_bl`),
    line(`${name}_left`, `${name}_bl`, `${name}_tl`),
  ]);
  const pieces = entries.map(([name]) => ({
    name,
    outline: ["top", "right", "bottom", "left"].map((side) => ({ curve: `${name}_${side}` })),
    grainline: { from: `${name}_gt`, to: `${name}_gb` },
  }));
  const result = evaluatePattern({ version: 1, points, curves, pieces }, { measurements: {} });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}
