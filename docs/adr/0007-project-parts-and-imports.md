# 0007: Project parts and imports

Status: accepted (ticket 0007)

## Context
A sleeve must fit the armhole of the bodice it is sewn into, and follow it when the bodice
changes. That needs a project with more than one block, and a way for one block to use values
computed by another. ADR 0004 (decision 8) limits `length(curve)` to the same definition, and ADR
0006 gives a project exactly one definition. All geometry stays in the engine; Elixir stores and
validates only (`docs/product.md`).

## Decision
1. **Project parts.** A project keeps its existing `definition` and `parameters` as its **main
   part**, named by the project's `block` key (for example `bodice`). Added parts live in a new
   jsonb column `pattern_projects.parts`, an `embeds_many` of `%{name, block, definition,
   parameters}`. `name` equals the block key, so a block can be added to a project once. Parts are
   copied from the block on add, as on create (ADR 0006). Existing projects stay valid without a
   data migration (`parts` defaults to `[]`). For now parts can only be catalogue blocks.
2. **Cross-part references are top-level `imports`** in the pattern definition (optional and
   additive, so no version bump, ADR 0004 decision 1): `{ "<local name>": "<part>.<value>" }`,
   for example `"back_armhole_length": "bodice.back_armhole_length"`. The local name joins the
   definition's single namespace as a value (source `import`), like a measurement. `<value>` is a
   name in the other part's result `values`, in practice a formula. Formulas are unchanged: there
   are no dotted names in the grammar (ADR 0003 is untouched).
3. **Engine project API.** `compileProject(parts)` and `evaluateProject(parts, input)` (in
   `engine/src/geometry/project.ts`) compile each part once, order the parts by their imports
   (topological), evaluate each and feed every import from the source part's `values`. An unknown
   part, a missing value, a failed source part or a cycle of parts gives `missing_import` on the
   import's local name in the importing part; its dependants get `failed_dependency`, as for a
   missing measurement. The result is a drawing or an error, never a wrong drawing. Input is the
   measurements plus parameter overrides per part name. The project page evaluates all parts in
   one client call, so a redraw (for example a profile switch) recomputes the sleeve with the
   bodice.
4. **Imported names are a stable interface.** Renaming a value another block imports requires
   migrating stored copies (ADR 0006). The bodice's interface is `armhole_length`,
   `back_armhole_length`, `front_armhole_length`, `back_armhole_to_notch` and
   `front_armhole_to_notch`; an engine test pins all five.
5. **Addability is a name check in Elixir, with no geometry.** A block with `imports` can be added
   when it is not yet in the project and every import names a part of the project whose stored
   definition declares that value (as a formula, parameter, measurement or import). Blocks with
   `imports` are not base blocks: they are not offered under "Nytt mönster" and creating a project from one
   is rejected. `Toile.Patterns.add_part/3` is scoped (ADR 0001), takes a row lock, rechecks
   addability inside the transaction (a client-supplied block key is whitelisted, a double click
   cannot add twice) and never turns the key into an atom. A bodice project created before the
   notch values existed keeps its own copy without them (ADR 0006) and is therefore not offered a
   sleeve.
6. **Layout is geometry, so it is the engine's.** `layoutParts` places parts side by side in
   project order, `PART_GAP` (50 mm) apart with tops aligned; the view applies the result as a
   translate. Parts are separate coordinate systems and do not interact.
7. **No solver in the engine.** The sleeve cap height is solved so the cap equals the imported
   armhole plus ease. The cap length has a closed form in width and height, so the block unrolls a
   few Newton steps as ordinary formulas (accuracy and sensitivity are pinned by engine tests).
   Formulas stay a plain dependency graph.

Notches (a piece field) are decided in ADR 0004 decision 17.

Rejected alternatives:
- Moving everything into `parts`: churn and a data migration for no present gain.
- A separate `pattern_parts` table: ownership and cascade machinery for a list of one or two items.
- Merging the sleeve into the bodice definition: the sleeve would not be a block of its own, and
  existing bodice projects could never get one.
- Dotted references in formulas: a grammar change.
- Passing armhole lengths as measurements: they are not catalogue keys (ADR 0005), and
  `missing_measurements` would misreport them.
- A parameter with a default value for the armhole: silently wrong when the bodice is missing or
  changed.
- A general equation solver in the engine: unbounded cost on the drag path.

## Consequences
- A project has one or more parts; the editor (0008) edits and saves the definition and
  parameters of each part, and `compileProject` is its drag-time entry point.
- The size cap of ADR 0006 applies to each stored definition. `list_pattern_projects/1` does not
  load `parts`.
- The measurements a project needs are the union of its parts' declared measurements, so adding
  the sleeve can make the page ask for arm measurements.
- Removing a part is not supported yet; a project with an unwanted sleeve can be deleted and
  recreated.
- Later blocks (collar, cuff, waistband) can import from existing parts the same way.
