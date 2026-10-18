defmodule Toile.Repo.Migrations.CreatePatternProjects do
  use Ecto.Migration

  def change do
    create table(:pattern_projects, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, size: 100, null: false
      # The key of the block in engine/blocks/ the project started from, for display only.
      add :block, :string, size: 100, null: false
      # A copy of the block's pattern definition made at creation (ADR 0006); the block file is
      # never re-read for an existing project.
      add :definition, :map, null: false
      # Parameter overrides ({"ease_hip": 60, ...}); the definition holds the defaults.
      add :parameters, :map, null: false, default: %{}

      # Deleting a profile keeps its projects; the page then asks for another profile.
      add :measurement_profile_id,
          references(:measurement_profiles, type: :binary_id, on_delete: :nilify_all)

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:pattern_projects, [:user_id])
    create index(:pattern_projects, [:measurement_profile_id])

    create constraint(:pattern_projects, :definition_must_be_an_object,
             check: "jsonb_typeof(definition) = 'object'"
           )

    create constraint(:pattern_projects, :parameters_must_be_an_object,
             check: "jsonb_typeof(parameters) = 'object'"
           )
  end
end
