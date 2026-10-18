defmodule Toile.Repo.Migrations.CreatePatternProjects do
  use Ecto.Migration

  def change do
    # The target of the composite foreign key below; `id` alone is already unique.
    create unique_index(:measurement_profiles, [:id, :user_id])

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

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      # Composite key: the profile must belong to the project's user, enforced here as well as in
      # Toile.Patterns. MATCH SIMPLE skips the check while `measurement_profile_id` is null.
      # Deleting a profile keeps its projects (the page then asks for another profile) and clears
      # only `measurement_profile_id`, never `user_id` (column list needs Postgres 15+).
      add :measurement_profile_id,
          references(:measurement_profiles,
            type: :binary_id,
            with: [user_id: :user_id],
            match: :simple,
            on_delete: {:nilify, [:measurement_profile_id]}
          )

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
