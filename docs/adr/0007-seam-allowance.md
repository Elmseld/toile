# 0007: Seam allowance

Status: accepted (ticket 0009)

## Context
A pattern cannot be cut out without seam allowance. The cutting line is geometry, so it is computed
in the engine; the project view (0015) and the PDF export (0010) only draw what the engine returns.
Block definitions have no allowances (ADR 0004) and are frozen for this ticket.

## Decision
- **Separate pure function.** `cuttingLine(piece, allowances)` works on a computed piece
  (`ComputedPiece` or anything with the same outline shape). Allowances are not part of the pattern
  definition and not part of `evaluatePattern`, so the drag path is unchanged. 0015 stores them.
- **Input.** `{ default, edges? }` in mm, each value finite and `0 <= v <= MAX_SEAM_ALLOWANCE`
  (100). Edges are keyed by curve name (stable identifiers, ADR 0004). `0` puts the cutting line on
  the edge (a fold). Names not in the piece are ignored, so one map serves every piece. Every
  invalid value gets its own `invalid_seam_allowance` error, and no line is returned. The function
  never throws and bounds its work (`MAX_CUTTING_LINE_SEGMENTS`); a degenerate piece gives
  `degenerate_geometry`.
- **Output is a polyline**: a closed polygon in mm (SVG coordinates), same rotational direction as
  the outline, starting at the leftmost point. Each edge is flattened and offset point by point,
  within about 0.02 mm of the true offset, far below print resolution (0.085 mm at 300 dpi). The
  offset of a cubic is not a cubic, so exact curves would need curve fitting, curve-curve
  intersection and cusp handling. A polyline makes the cleanup a segment problem and is trivially
  drawn by SVG and PDF. Cost: larger path data and no exact tangents; refitting to cubics can be
  added later behind the same function.
- **Corners.** A convex corner is a miter, clipped at `MITER_LIMIT` (4) times the larger allowance.
  A concave corner is the intersection of the two offset edges. A tangent-continuous join (within
  `SMOOTH_JOIN_ANGLE`) has no corner, or a straight step when the allowances differ.
- **Outer-boundary cleanup.** The raw offset can contain loops (concave joins, tight concave
  curves) and overlapping lobes (allowance wider than a narrow part). The cutting line is the outer
  boundary of the enclosed region, found by walking from the leftmost vertex and switching strands
  at every crossing. The result is checked (orientation, outline inside); failure is
  `degenerate_geometry`.
- **Darts** are detected geometrically: two consecutive straight legs of equal length (within
  `max(1 mm, 2 %)`) at a concave apex, wedge angle at most `MAX_DART_ANGLE` (60 degrees), in an
  outline of at least four entries, not sharing a neighbouring seam with an earlier dart. The cut
  edge across a dart is the cutting line of the neighbouring seams with the dart closed and pressed
  toward the seam before the dart in outline order, then unfolded (the dart peak). This is exact
  for any seam shape and allowance, except that a neighbouring seam too short to reach the
  construction ray is extended straight backwards. For symmetric darts the result is the same for
  either press direction. The legs are not on the cutting line, and their allowances are validated
  but unused.
- **Not marked up in definitions.** Detection covers every dart in the blocks. Explicit markup can
  be added later as an optional outline-entry field without a version bump.

## Rejected alternatives
- Edges by outline index (shifts when the editor inserts or removes a curve) or by end-point names
  (not in `ComputedCurve`, ambiguous).
- Allowances inside `evaluatePattern` or the definition now: they are output input, stored by 0015.
- A clipping library (Clipper ports): a new dependency for one function; the engine has none.
- Plain miter at darts (leaves a notch along the legs, wrong when sewn) or a symmetric peak on the
  centre line (wrong for asymmetric seams).
- A per-dart press direction as input: no consumer yet; an optional field can be added later.
- Mirrored hem corners as in some CAD tools: possible later as a corner-style option.

## Consequences
- 0015 stores the allowances (a project default; per-edge storage is its choice) and must fit its
  `viewBox` to the cutting-line points, since `patternBounds` covers outlines only and the line can
  lie up to `MAX_SEAM_ALLOWANCE * MITER_LIMIT` outside.
- Darts with curved or unequal legs are not detected and get a notch; they would need markup.
- Computing a line costs a sampled offset plus an intersection sweep, so a view should compute it
  once per drawn input.
- A press direction or corner style can be added as optional fields without breaking the API.
