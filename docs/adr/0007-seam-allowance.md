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
  invalid value gets its own `invalid_seam_allowance` error, and no line is returned. Errors are
  capped: a map with more than `MAX_SECTION_ENTRIES` (20 000) edges is one error, at most
  `MAX_ALLOWANCE_ERRORS` (100) errors are returned, and curve names are cut to 80 characters in
  messages (`edge` keeps the full name). Allowance errors come before geometry errors.
- **Never throws, bounded work.** A degenerate piece (empty, open, zero area, non-finite
  coordinates) gives `degenerate_geometry`. So does one over a work limit, with the message "too
  complex": `MAX_OUTLINE_ENTRIES` (1000) outline entries, `MAX_CUTTING_LINE_SEGMENTS` (20 000)
  flattening segments, `MAX_RAW_LINE_POINTS` (50 000) points in the raw line (offset edges, joins
  and dart peaks), and a shared sweep budget of `MAX_SWEEP_PAIRS` compared segment pairs and
  `MAX_CROSSINGS` crossings. A self-crossing outline is rejected up front at every allowance,
  because whether the later checks catch it would otherwise depend on the allowance (touching and
  collinear contacts do not count, so dart legs and folds are fine).
- **Output is a polyline**: a closed polygon in mm (SVG coordinates), same rotational direction as
  the outline, starting at the leftmost point. Each edge is flattened and offset point by point,
  within about 0.02 mm of the true offset, far below print resolution (0.085 mm at 300 dpi). The
  offset of a cubic is not a cubic, so exact curves would need curve fitting, curve-curve
  intersection and cusp handling. A polyline makes the cleanup a segment problem and is trivially
  drawn by SVG and PDF. Cost: larger path data and no exact tangents; refitting to cubics can be
  added later behind the same function.
- **Corners.** A convex corner is a miter, clipped at `MITER_LIMIT` (4) times the larger allowance.
  One exception: a corner that turns by less than 90 degrees can only exceed the limit when its
  allowances differ widely (a 40 mm hem and a 10 mm side seam below about 11 degrees). Its miter
  then lies on the wider edge's offset line behind that edge's end, so clipping it on the bisector
  would run far along the nearly parallel edges. Such a corner is a straight step between the two
  offset ends instead (a bevel, as SVG does past its miter limit), which keeps at least the smaller
  allowance from the outline. Where a miter would come closer to the outline than the smaller allowance (next to a curve that
  curls away sharply), the corner is round instead. A concave corner is the intersection of the two
  offset edges. A tangent-continuous join (within `SMOOTH_JOIN_ANGLE`) has no corner, or a straight
  step when the allowances differ.
- **Safe fallback.** If the result of the construction above fails its checks (outlines with
  sharply curling curves), a conservative one is tried: every convex corner round, concave corners
  only where the offset edges really cross, no extended edges, darts as ordinary edges. The result
  then carries `safe_construction` in `approximations`. A piece that needs it costs about twice as
  much.
- **Outer-boundary cleanup.** The raw offset can contain loops (concave joins, tight concave
  curves) and overlapping lobes (allowance wider than a narrow part). The cutting line is the outer
  boundary of the enclosed region, found by walking from the leftmost vertex and switching strands
  at every crossing. The result is checked (no self-crossing, no crossing of the outline, orientation, every
  outline vertex inside or on it); failure of both constructions is `degenerate_geometry`.
- **Darts** are detected geometrically: two consecutive straight legs of equal length (within
  `max(1 mm, 2 %)`) at a concave apex, wedge angle at most `MAX_DART_ANGLE` (60 degrees), in an
  outline of at least four entries. The cut edge across a dart is the cutting line of the
  neighbouring seams with the dart closed and pressed toward the seam before the dart in outline
  order, then unfolded (the dart peak). This is exact for any seam shape and allowance, except
  that a neighbouring seam too short to reach the construction ray is extended straight backwards.
  For symmetric darts the result is the same for either press direction. The legs are not on the
  cutting line, and their allowances are validated but unused.
  - Legs that differ in length within the tolerance are matched at their top ends (a shift after
    closing).
  - If the closed seam has a bend at the dart mouth (an untrued waist) close to the fold, within
    `DART_BEND_SNAP` (0.25) times the larger allowance, the bend is treated as lying on the fold.
    Otherwise it would appear twice as a jog of about 1 mm segments. This is an approximation: the
    cut is short by a few hundredths of the allowance at most.
  - Two darts with one seam between them (two waist darts per side) are chained and both get a
    peak, the line running from one to the other. The chain stops where the seam between is too
    short for the allowance; the dart after it is then cut as ordinary edges.
  - A detected dart whose peak cannot be built is cut as ordinary edges (a notch) and listed as
    `dart_without_peak` in `approximations`, with `legs` the two outline indices of its legs in the
    piece's own `outline`.
- **Approximations are reported.** The ok result has an optional `approximations` list
  (`CuttingLineApproximation`: `safe_construction`, `dart_without_peak`), present only when
  non-empty, so a caller can tell the user that the line is not the full construction.
- **Modules** (`engine/src/geometry`): `offset.ts` (flattening, edge offset), `joins.ts` (corner
  joins), `boundary.ts` (crossing sweep, outer boundary, work budget), `darts.ts` (detection, dart
  peak), `seam-allowance.ts` (input, assembly, checks, public function).
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
  `viewBox` to the cutting-line points, since `patternBounds` covers outlines only. The line lies
  at most `hypot(MITER_LIMIT * a, a)`, about 4.12 times the largest allowance `a`, from the
  outline. 0015 must render error messages as text, never as HTML: curve names are user-controlled.
- Computing a line costs a sampled offset plus an intersection sweep: about 0.1 ms per skirt piece
  and 0.2 to 0.25 ms per bodice piece, twice that with the safe fallback. The worst hostile
  outlines at the entry limit take at most about 0.2 s and 100 MB. A view should still compute it
  once per drawn input.
- A press direction or corner style can be added as optional fields without breaking the API.

## Known limitations
- The press direction is fixed: toward the seam before the dart in outline order.
- Darts with curved legs, or legs unequal beyond the tolerance, are not detected and get a notch;
  they would need markup.
- The back neckline of the bodice (`b_neckline`) has a radius under 4 mm at the shoulder, so its
  cutting line has a concave kink there. That is true offset geometry; the fix belongs in the
  bodice block (follow-up), which is frozen for this ticket.
- Two darts a few mm apart at 50 to 100 mm allowance can give a line that touches the outline in
  one direction (found in a pre-existing case; open follow-up).
