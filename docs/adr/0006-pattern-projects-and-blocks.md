# 0006: Pattern projects and blocks

Status: accepted (ticket 0005)

## Context
Ticket 0005 introduces pattern projects (a user's pattern, linked to a measurement profile) and the
first block, the straight skirt. Blocks must live as data, projects must not change when a block is
later improved, and all geometry stays in the engine (`docs/product.md`). The project page runs the
engine in the browser.

## Decision
- **Blocks are data** in `engine/blocks/<key>.json`: version 1 pattern definitions (ADR 0004). The
  key is the file name and matches `^[a-z][a-z0-9_]*$`.
- **Copy on create.** Creating a project copies the block's definition into `pattern_projects.definition`
  (jsonb). The block file is never re-read for an existing project, so later block changes do not
  affect it. `block` stores the key for display only. Parameter overrides are stored in
  `parameters` (jsonb, `{}` at creation).
- **Elixir reads blocks at compile time** in `Toile.Patterns.Blocks` (`@external_resource` per
  file, recompiling when files are added), modelled on `Toile.Measurements.Catalog` (ADR 0005). It
  validates only shape (JSON object, integer `version`, `measurements` list) and never geometry.
  The engine validates the definition on the client. Any release image build must include
  `engine/blocks` and `engine/src`.
- **Limits.** At most 100 projects per user (advisory lock, as for measurement profiles) and a
  definition of at most 1 000 000 bytes encoded.
- **Ownership.** Scoped per user (ADR 0001). The chosen `measurement_profile_id` must belong to the
  same user (checked in the context, since a foreign key only proves existence). Deleting a profile
  sets it to null (`nilify_all`) instead of deleting projects; the page then asks for a profile.
- **Missing measurements** are determined in Elixir only by comparing the definition's declared
  `measurements` with the profile's nil values (names, not geometry); the page then draws nothing.
  Nulls are dropped when building engine input (ADR 0005).
- **Client.** A LiveView external hook (`PatternView`) imports the engine from `engine/src` through
  esbuild, compiles the definition once and computes the pattern once per mount. Zoom and pan change
  only the SVG `viewBox`. Switching profile remounts the hook (keyed wrapper element), with no
  `push_event`. CI builds the JS bundle so a broken engine import fails.
- jsonb does not preserve object key order. The engine's results do not depend on it; only the
  order of reported errors can differ. Arrays keep their order.

## Alternatives rejected
- Blocks in the database: seed drift between environments.
- Blocks as Elixir code: geometry definitions in two languages.
- Server-side rendering of geometry: violates "all geometry in the engine".
- `push_event` for profile switching: a keyed remount is simpler and does not depend on patching an
  element LiveView ignores.

## Consequences
- Improving a block never updates existing projects; a future "update to the latest block" would be
  an explicit user action.
- Editing points and parameters (0008) changes the stored `definition` and `parameters`; the size
  limit already applies.
- The first client bundle imports TypeScript from `engine/`, so the engine must stay free of DOM and
  Node-only APIs.
