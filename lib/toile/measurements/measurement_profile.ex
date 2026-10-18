defmodule Toile.Measurements.MeasurementProfile do
  @moduledoc """
  A named set of body measurements owned by one user (`docs/adr/0001-per-user-scope.md`).

  The measurements are an embedded `Toile.Measurements.Values` stored as a jsonb map of integer
  millimetres per catalogue key (`docs/adr/0005-measurement-keys.md`). A profile may be
  incomplete: only the name is required.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Toile.Measurements.Values

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "measurement_profiles" do
    field :name, :string
    embeds_one :measurements, Values, on_replace: :update, defaults_to_struct: true
    field :user_id, :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for creating or updating a profile owned by `user_scope`.

  `user_id` is never cast; it always comes from the scope.
  """
  def changeset(measurement_profile, attrs, user_scope) do
    measurement_profile
    |> cast(attrs, [:name])
    |> validate_required([:name])
    |> validate_length(:name, max: 100)
    |> cast_embed(:measurements, with: &Values.changeset/2)
    |> put_change(:user_id, user_scope.user.id)
  end
end
