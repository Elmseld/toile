defmodule Toile.Repo.Migrations.ValidateSeamAllowancesConstraint do
  use Ecto.Migration

  # In its own migration, so its own transaction: VALIDATE CONSTRAINT scans the rows under a
  # SHARE UPDATE EXCLUSIVE lock, which lets reads and writes go on.
  def up do
    execute "ALTER TABLE pattern_projects VALIDATE CONSTRAINT seam_allowances_must_have_default_and_edges"
  end

  # A validated constraint cannot be marked NOT VALID again; rolling back the previous migration
  # drops it.
  def down, do: :ok
end
