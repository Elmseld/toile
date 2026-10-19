import { describe, expect, test } from "bun:test";
import { layoutParts, PART_GAP } from "./layout";

describe("layoutParts", () => {
  test("places parts side by side, PART_GAP apart, tops aligned with the first", () => {
    expect(PART_GAP).toBe(50);
    const layout = layoutParts([
      { minX: 0, minY: -20, maxX: 500, maxY: 400 },
      { minX: -200, minY: 0, maxX: 200, maxY: 600 },
    ]);
    expect(layout.offsets).toEqual([
      { dx: 0, dy: 0 },
      { dx: 750, dy: -20 },
    ]);
    expect(layout.bounds).toEqual({ minX: 0, minY: -20, maxX: 950, maxY: 580 });
  });

  test("a part without bounds gets no offset and takes no room", () => {
    const layout = layoutParts(
      [null, { minX: 10, minY: 10, maxX: 20, maxY: 20 }, null, { minX: 0, minY: 0, maxX: 5, maxY: 5 }],
      10,
    );
    expect(layout.offsets).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 30, dy: 10 },
    ]);
    expect(layout.bounds).toEqual({ minX: 10, minY: 10, maxX: 35, maxY: 20 });
  });

  test("no parts, or none with bounds, gives bounds null", () => {
    expect(layoutParts([])).toEqual({ offsets: [], bounds: null });
    expect(layoutParts([null])).toEqual({ offsets: [{ dx: 0, dy: 0 }], bounds: null });
  });
});
