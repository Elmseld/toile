defmodule Toile.Repo.Migrations.AddPartsToPatternProjects do
  use Ecto.Migration

  def change do
    alter table(:pattern_projects) do
      # Blocks added to the project after it was created, such as a sleeve on a bodice (ADR
      # 0007): [{"name", "block", "definition", "parameters"}], each definition a copy made when
      # the part was added. The block the project started from stays in `definition` and
      # `parameters`, so existing rows need no data migration: they get no parts.
      add :parts, :map, null: false, default: fragment("'[]'::jsonb")
    end

    create constraint(:pattern_projects, :parts_must_be_an_array,
             check: "jsonb_typeof(parts) = 'array'"
           )
  end
end
