defmodule Toile.Repo.Migrations.CreateMeasurementProfiles do
  use Ecto.Migration

  def change do
    create table(:measurement_profiles, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      # Integer millimetres per catalogue key ({"waist": 725, ...}); a missing or null key means
      # "not measured". The key list lives in engine/src/measurements.json (ADR 0005), so adding
      # a key needs no migration.
      add :measurements, :map, null: false, default: %{}
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create index(:measurement_profiles, [:user_id])
  end
end
