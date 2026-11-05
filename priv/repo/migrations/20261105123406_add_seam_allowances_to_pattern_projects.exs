defmodule Toile.Repo.Migrations.AddSeamAllowancesToPatternProjects do
  use Ecto.Migration

  def change do
    alter table(:pattern_projects) do
      # Seam allowances in mm (ADR 0011): the project default and the user's values per edge,
      # {"default": mm, "edges": {"<part>": {"<curve>": mm}}}. Existing rows get the default of
      # a new project, 10 mm, and no values per edge.
      add :seam_allowances, :map,
        null: false,
        default: fragment(~s|'{"default": 10, "edges": {}}'::jsonb|)
    end

    # Every row must load into `Toile.Patterns.SeamAllowances`, or the project list breaks. A
    # missing key gives `jsonb_typeof` NULL, which a CHECK would let through, hence `coalesce`.
    # Added NOT VALID so this migration does not scan the table under the ACCESS EXCLUSIVE lock of
    # the `alter table`; the next migration validates it under a weaker lock.
    create constraint(:pattern_projects, :seam_allowances_must_have_default_and_edges,
             check: """
             jsonb_typeof(seam_allowances) = 'object'
             AND coalesce(jsonb_typeof(seam_allowances -> 'default'), '') = 'number'
             AND coalesce(jsonb_typeof(seam_allowances -> 'edges'), '') = 'object'
             """,
             validate: false
           )
  end
end
