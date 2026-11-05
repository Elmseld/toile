# Product description

<!-- Agents read this file before every ticket. Keep it current and concrete. -->

## What is the product?
Toile is a web app for drafting and developing sewing patterns. The user starts from parametric
blocks (bodice, skirt, sleeve) that are calculated from their own measurements, modifies them, and
prints them at 1:1 scale. The app targets both hobby sewists and professional pattern makers.
Both groups use the same engine but get different amounts of it exposed.

## Users and roles
- **User**: one account, their own measurement profiles and their own pattern projects. Sees and
  changes only their own. Registers with email, confirms via a link, and logs in with an email
  link or a password. Forgotten password: log in with an email link and choose a new password
  under "Inställningar" (Settings). Registration and email change never reveal whether an address
  already has an account (the owner gets an email instead). Settings require a recent login.
  Logged-in users land on "Mina mönster" (My patterns, `/patterns`); logged-out users see a short
  description of Toile.
- Modes (after the MVP): **hobby mode** (sliders and guided adjustment) and **pro mode** (free
  drafting, formulas, grading). The MVP has a single mode, closest to pro mode but kept simple.

## Core flows (MVP)
1. **Measurements**: under "Mått" (`/measurements`) the user creates a measurement profile ("Jag",
   "Kund Anna") and fills in a fixed list of 18 measurements with help texts. Input is in cm with
   one decimal (`.` or `,`), stored in mm. A profile can be saved incomplete; the list shows how
   many measurements are missing and the profile page marks each missing one. Values of 0 or over
   300 cm are rejected. A user can have at most 100 profiles; the 101st shows a form error. The
   form is touch-friendly: one field per row, 44 px minimum height, numeric keyboard.
2. **New pattern**: under "Mina mönster" (`/patterns`) the user clicks "Nytt mönster"
   (`/patterns/new`), names the project and picks a block ("Rak kjol", a straight skirt, or
   "Liv", a bodice) from a select with the prompt "Välj ett grundmönster" (no preselection)
   and one of their measurement profiles. The project page (`/patterns/:id`) calculates the pattern
   in the browser and draws the front and back pieces to scale over a centimetre grid, with zoom
   (wheel, pinch, zoom in/out buttons), pan (drag) and a "Fit to screen" ("Anpassa till skärmen")
   button. With the keyboard, the arrow keys pan, + and - zoom and 0 fits the pattern. A profile
   select on the page switches profile and redraws; if the switch is rejected, the page reloads
   showing the stored profile with the error flash "Det gick inte att byta måttprofil". If the
   profile lacks measurements the block needs, the page lists them (with a link to edit the profile;
   saving or cancelling there returns to the project) instead of drawing. Projects can be renamed
   and deleted from the list; a user can have at most 100. Deleting a profile keeps its projects,
   which then ask for a new profile. A project stores a copy of the block definition, so later
   changes to a block do not affect it. Only base blocks are offered under "Nytt mönster". On the
   page of a bodice project, a section "Lägg till i mönstret" offers the button "Rak ärm" (a
   one-piece sleeve; not offered twice, and not for skirts). The sleeve is drawn beside the
   bodice, fitted to the bodice's armhole (the cap is the armhole plus a set cap ease) and
   recomputed whenever the bodice is, for example on a profile switch or an edit. Notches mark how
   the parts are sewn together: a double notch on the back armhole and the sleeve cap, a single one
   at the front, and one at the sleeve crown (matches the shoulder seam). The skirt has a notch at the hip on each side seam, double at the back. Adding the sleeve makes
   the page ask for the arm measurements (upper arm, arm length, wrist) if the profile lacks them.
   A sleeve cannot be removed yet.
3. **Modify**: on the project page every point of every part (the bodice and an added sleeve
   alike) is a handle that can be dragged with mouse, touch or pen; the control points of Bézier
   curves too. Dependent points, curves and pieces follow during the drag, with no server call,
   and so do the parts that import from the edited one (dragging the bodice armhole reshapes the
   sleeve cap). Selecting a point (click or tap, or the select with the prompt "Välj en punkt",
   grouped by part when there are several) shows its operation and fields; its formula fields
   are editable (in millimetres), and an invalid formula shows an error under the field while the
   drawing stays as it was. The panel shows the point's offset in cm with the button "Återställ
   läget". A panel "Justeringar" lists the parameters of each part (e.g. ease, "Rörelsevidd,
   stuss"), under the part's name when there are several, in cm or degrees; an empty field returns
   to the default. "Ångra" and "Gör om" (also Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y) step
   through the last 100 edits per page visit, across all parts; the history is lost on reload.
   Changes save automatically ("Sparar...", "Sparat", or "Ändringarna kunde inte sparas"), and a
   reload shows the same pattern. Only point offsets, point formulas and parameter overrides can be
   edited; point names, operations, curves and pieces cannot (ADR 0008). Switching measurement
   profile recalculates the whole pattern and keeps the edits.
4. **Finish** (ticket 0015): every piece shows its seam line (dashed) inside its cutting line
   (solid, the seam line plus seam allowance). A piece shows its name and its cutting instruction
   ("klipp 2", or "klipp 1 i fold" with a fold), the grainline arrow, a dash-dot fold line on each
   fold edge, and its notches on both the seam line and the cutting line. The panel "Sömsmån" sets
   the project's seam allowance (default 1 cm; an empty field means 1 cm; 0 to 10 cm). A single
   edge is selected by tapping or clicking it in the drawing, or with the select "Välj en kant",
   and its allowance set in cm (0 is allowed; an empty field removes the override). A fold edge
   has 0 unless set ("Fold: 0 cm"). Changes redraw at once, save automatically and take part in
   undo and redo. If no cutting line can be drawn, or it is approximated, the page says so in
   words. Projects created before 0015 have no cutting instruction, fold or skirt notches (they
   keep their block copy) but get everything else. Storage and rules: ADR 0011.
5. **Print**: PDF at 1:1 scale, tiled on A4 with overlap, numbering and a test square.

## Domain glossary
The UI is Swedish, so the Swedish UI term is given in parentheses.

| Term | Meaning |
|------|---------|
| Measurement (mått) | A body measurement in a measurement profile, e.g. `waist`, `hip`, `back_length`. The keys are fixed and defined in `engine/src/measurements.json` (ADR 0005). |
| Measurement profile (måttprofil) | Named set of measurements for one person. |
| Block (grundmönster) | Template pattern defined by formulas against measurements, without design and without seam allowance. |
| Pattern definition (mönsterdefinition) | Data (JSON) describing parameters, points, curves and pattern pieces. This is what gets stored. |
| Parameter | Named value that is not a body measurement, e.g. `ease_hip`. Can be exposed as a slider. |
| Point (punkt) | Defined by an operation (e.g. "along line A–B, distance `waist/4`"), not by free coordinates. |
| Pattern piece (mönsterdel) | Closed outline of lines/curves, e.g. "front piece". Has a grainline, a cutting instruction and a seam allowance per edge. |
| Pattern project (mönsterprojekt) | A user's pattern: a copy of a block plus its modifications and parameter overrides, linked to a measurement profile. |
| Part | A block copy inside a project: the block the project was created from, plus blocks added later, such as a sleeve. A part can import values from another part (ADR 0007). Not a UI term. |
| Notch (hack) | Balance mark on the outline; matching notches on two pieces show which points are sewn together. Not yet a UI term. |
| Dart (inprovning) | Wedge-shaped fold that shapes the garment. |
| Seam allowance (sömsmån) | Extra margin outside the seam line. Default 1 cm per project, changeable per edge; 0 at a fold. |
| Seam line (sömlinje) | The outline of a piece, where it is sewn. Drawn dashed. |
| Cutting line (klipplinje) | The seam line moved outwards by the seam allowance. Drawn solid. |
| Fold (fold) | An edge of a piece that lies on a fold of the fabric; it has no seam allowance and is cut "på fold". |
| Tiling (kakling) | Splitting a 1:1 pattern across several A4 pages. |

## Technology
- **Phoenix 1.8 / LiveView** (Elixir 1.20, OTP 29) for accounts, measurement profiles and storage
  of pattern projects. Blocks are JSON files in `engine/blocks/` (ADR 0006). The dev environment (Postgres 17, Elixir, Bun) runs via `docker compose`.
- **`engine/`**: the pattern engine as a pure TypeScript package (Bun for tests and type checking).
  It takes a pattern definition, measurements and parameters and returns geometry. It has no DOM
  and no I/O. The editor, the PDF export and possibly server rendering use the same code.
- The editor is a LiveView page with a JS hook that runs the engine in the client and draws SVG.
  Dragging and recalculation happen entirely in the client. The server receives the saved result
  (the pattern definition).
- CI: GitHub Actions (`.github/workflows/ci.yml`).
- Checks: see `CLAUDE.md`.

## Principles and constraints
- **All geometry is calculated in the engine.** Elixir stores and validates pattern definitions but
  never computes geometry. No geometry logic in two languages.
- **Patterns are parametric.** Points are defined relative to measurements, parameters and other
  points, so a pattern can be recalculated for new measurements. Free coordinates are only allowed
  as an offset from a defined point.
- **Units**: all lengths are stored and calculated in millimetres. The UI shows centimetres with
  one decimal.
- **Coordinate system**: origin at the top left, x to the right, y downward (like SVG).
- Everything a user owns (measurement profiles, projects) is private to that user and scoped per account.
- Must work with mouse, touch and pen (pointer events) on desktop and tablet.
- Printing must be true to scale. The test square in the PDF must measure exactly 10 × 10 cm.

## Later (not MVP)
Grading and size series, hobby mode with exposed sliders, publishing and marketplace, marker
layout and fabric consumption, projector mode, version history with fitting notes, 3D preview,
export to SVG/DXF.
