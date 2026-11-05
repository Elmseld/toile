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

    create constraint(:pattern_projects, :seam_allowances_must_be_an_object,
             check: "jsonb_typeof(seam_allowances) = 'object'"
           )
  end
end
