// Projects for the print tests (not part of the engine's API): the real blocks against a medium
// profile, and hand-built rectangles.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePattern } from "../geometry/evaluate";
import { evaluateProject, type ProjectResult } from "../geometry/project";
import type { ComputedPattern } from "../geometry/types";

const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");

// The medium profile of seam-allowance-blocks.test.ts, with the arm measurements of blocks.test.ts.
// prettier-ignore
export const MEDIUM: Record<string, number> = {
  bust: 880, waist: 680, hip: 940, neck: 370, shoulder_width: 122, back_width: 344,
  chest_width: 324, back_length: 410, armhole_depth: 210, front_length: 445, bust_height: 265,
  bust_distance: 190, hip_height: 206, skirt_length: 600, upper_arm: 280, arm_length: 580,
  wrist: 160,
};

export function block(name: string): unknown {
  return JSON.parse(readFileSync(join(BLOCKS_DIR, `${name}.json`), "utf8"));
}

/** An ok project of the given blocks (part name = block name), for the medium profile. */
export function project(...blocks: string[]): ProjectResult {
  const result = evaluateProject(
    blocks.map((name) => ({ name, definition: block(name) })),
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
