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
   "Kund Anna") and fills in a fixed list of 17 measurements with help texts. Input is in cm with
   one decimal (`.` or `,`), stored in mm. A profile can be saved incomplete; the list shows how
   many measurements are missing and the profile page marks each missing one. Values of 0 or over
   300 cm are rejected. A user can have at most 100 profiles; the 101st shows a form error. The
   form is touch-friendly: one field per row, 44 px minimum height, numeric keyboard.
2. **New pattern**: under "Mina mönster" (`/patterns`) the user clicks "Nytt mönster"
   (`/patterns/new`), names the project and picks a block (first block: "Rak kjol", a straight
   skirt) and one of their measurement profiles. The project page (`/patterns/:id`) calculates the
   pattern in the browser and draws the front and back pieces to scale over a centimetre grid, with
   zoom (wheel, pinch, zoom in/out buttons), pan (drag) and a "Fit to screen" ("Anpassa till
   skärmen") button. With the keyboard, the arrow keys pan, + and - zoom and 0 fits the pattern. A
   profile select on the page switches profile and redraws; if the switch is rejected, the page
   reloads showing the stored profile with the error flash "Det gick inte att byta måttprofil". If the profile lacks measurements the block needs, the page lists
   them (with a link to edit the profile) instead of drawing. Projects can be renamed and deleted
   from the list; a user can have at most 100. Deleting a profile keeps its projects, which then
   ask for a new profile. A project stores a copy of the block definition, so later changes to a
   block do not affect it.
3. **Modify**: the user drags points, edits formulas or parameters (e.g. ease), and the pattern is
   recalculated immediately. Switching measurement profile recalculates the whole pattern.
4. **Finish**: seam allowance is added per edge. Markings (grainline, notches, fold line) are shown.
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
| Pattern piece (mönsterdel) | Closed outline of lines/curves, e.g. "front piece". Has a grainline and seam allowance per edge. |
| Pattern project (mönsterprojekt) | A user's pattern: a copy of a block plus its modifications and parameter overrides, linked to a measurement profile. |
| Dart (inprovning) | Wedge-shaped fold that shapes the garment. |
| Seam allowance (sömsmån) | Extra margin outside the seam line. |
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
