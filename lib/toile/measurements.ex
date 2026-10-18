defmodule Toile.Measurements do
  @moduledoc """
  The Measurements context: measurement profiles owned by the current user.

  Every function that reads or writes profiles takes a `%Toile.Accounts.Scope{}` first and only
  touches that user's profiles (`docs/adr/0001-per-user-scope.md`). Measurement values are
  integer millimetres keyed by `Toile.Measurements.Catalog` (`docs/adr/0005-measurement-keys.md`).
  """

  import Ecto.Query, warn: false
  alias Toile.Repo

  alias Toile.Accounts.Scope
  alias Toile.Measurements.Catalog
  alias Toile.Measurements.MeasurementProfile

  @doc """
  Subscribes to scoped notifications about any measurement_profile changes.

  The broadcasted messages match the pattern:

    * {:created, %MeasurementProfile{}}
    * {:updated, %MeasurementProfile{}}
    * {:deleted, %MeasurementProfile{}}

  """
  def subscribe_measurement_profiles(%Scope{} = scope) do
    key = scope.user.id

    Phoenix.PubSub.subscribe(Toile.PubSub, "user:#{key}:measurement_profiles")
  end

  defp broadcast_measurement_profile(%Scope{} = scope, message) do
    key = scope.user.id

    Phoenix.PubSub.broadcast(Toile.PubSub, "user:#{key}:measurement_profiles", message)
  end

  @doc """
  Returns the scope's measurement profiles, ordered by name (then creation time).

  ## Examples

      iex> list_measurement_profiles(scope)
      [%MeasurementProfile{}, ...]

  """
  def list_measurement_profiles(%Scope{} = scope) do
    Repo.all(
      from p in MeasurementProfile,
        where: p.user_id == ^scope.user.id,
        order_by: [asc: p.name, asc: p.inserted_at]
    )
  end

  @doc """
  Gets a single measurement_profile.

  Raises `Ecto.NoResultsError` if the Measurement profile does not exist.

  ## Examples

      iex> get_measurement_profile!(scope, 123)
      %MeasurementProfile{}

      iex> get_measurement_profile!(scope, 456)
      ** (Ecto.NoResultsError)

  """
  def get_measurement_profile!(%Scope{} = scope, id) do
    Repo.get_by!(MeasurementProfile, id: id, user_id: scope.user.id)
  end

  @doc """
  Creates a measurement_profile.

  ## Examples

      iex> create_measurement_profile(scope, %{field: value})
      {:ok, %MeasurementProfile{}}

      iex> create_measurement_profile(scope, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def create_measurement_profile(%Scope{} = scope, attrs) do
    with {:ok, measurement_profile = %MeasurementProfile{}} <-
           %MeasurementProfile{}
           |> MeasurementProfile.changeset(attrs, scope)
           |> Repo.insert() do
      broadcast_measurement_profile(scope, {:created, measurement_profile})
      {:ok, measurement_profile}
    end
  end

  @doc """
  Updates a measurement_profile.

  ## Examples

      iex> update_measurement_profile(scope, measurement_profile, %{field: new_value})
      {:ok, %MeasurementProfile{}}

      iex> update_measurement_profile(scope, measurement_profile, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def update_measurement_profile(
        %Scope{} = scope,
        %MeasurementProfile{} = measurement_profile,
        attrs
      ) do
    true = measurement_profile.user_id == scope.user.id

    with {:ok, measurement_profile = %MeasurementProfile{}} <-
           measurement_profile
           |> MeasurementProfile.changeset(attrs, scope)
           |> Repo.update() do
      broadcast_measurement_profile(scope, {:updated, measurement_profile})
      {:ok, measurement_profile}
    end
  end

  @doc """
  Deletes a measurement_profile.

  ## Examples

      iex> delete_measurement_profile(scope, measurement_profile)
      {:ok, %MeasurementProfile{}}

      iex> delete_measurement_profile(scope, measurement_profile)
      {:error, %Ecto.Changeset{}}

  """
  def delete_measurement_profile(%Scope{} = scope, %MeasurementProfile{} = measurement_profile) do
    true = measurement_profile.user_id == scope.user.id

    with {:ok, measurement_profile = %MeasurementProfile{}} <-
           Repo.delete(measurement_profile) do
      broadcast_measurement_profile(scope, {:deleted, measurement_profile})
      {:ok, measurement_profile}
    end
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking measurement_profile changes.

  ## Examples

      iex> change_measurement_profile(scope, measurement_profile)
      %Ecto.Changeset{data: %MeasurementProfile{}}

  """
  def change_measurement_profile(
        %Scope{} = scope,
        %MeasurementProfile{} = measurement_profile,
        attrs \\ %{}
      ) do
    true = measurement_profile.user_id == scope.user.id

    MeasurementProfile.changeset(measurement_profile, attrs, scope)
  end

  @doc """
  Returns the catalogue keys the profile has no value for, in catalogue order.

  Takes a profile that was already fetched through a scoped function, so it needs no scope.

  ## Examples

      iex> missing_measurements(%MeasurementProfile{measurements: %Values{waist: 725}})
      [:bust, :hip, ...]

  """
  def missing_measurements(%MeasurementProfile{measurements: measurements}) do
    Enum.filter(Catalog.keys(), &is_nil(Map.get(measurements, &1)))
  end
end
