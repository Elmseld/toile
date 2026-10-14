// Toile pattern engine: pure functions from measurements + pattern definition to geometry.
// No DOM, no I/O, so the same code runs in the editor, the PDF export and on the server.

export type Point = { x: number; y: number };

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
