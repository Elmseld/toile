defmodule Toile.Accounts do
  @moduledoc """
  The Accounts context.
  """

  import Ecto.Query, warn: false
  alias Toile.Repo

  alias Toile.Accounts.{User, UserToken, UserNotifier}

  ## Database getters

  @doc """
  Gets a user by email.

  ## Examples

      iex> get_user_by_email("foo@example.com")
      %User{}

      iex> get_user_by_email("unknown@example.com")
      nil

  """
  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: email)
  end

  @doc """
  Gets a user by email and password.

  ## Examples

      iex> get_user_by_email_and_password("foo@example.com", "correct_password")
      %User{}

      iex> get_user_by_email_and_password("foo@example.com", "invalid_password")
      nil

  """
  def get_user_by_email_and_password(email, password)
      when is_binary(email) and is_binary(password) do
    user = Repo.get_by(User, email: email)
    if User.valid_password?(user, password), do: user
  end

  @doc """
  Gets a single user.

  Raises `Ecto.NoResultsError` if the User does not exist.

  ## Examples

      iex> get_user!(123)
      %User{}

      iex> get_user!(456)
      ** (Ecto.NoResultsError)

  """
  def get_user!(id), do: Repo.get!(User, id)

  ## User registration

  @doc """
  Registers a user.

  ## Examples

      iex> register_user(%{field: value})
      {:ok, %User{}}

      iex> register_user(%{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def register_user(attrs) do
    %User{}
    |> User.email_changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Registers a user and emails them login instructions, without revealing
  whether the email address already has an account.

  On success the new user receives a magic link built with
  `magic_link_url_fun`. If registration fails only because the email is
  already taken, the existing account is emailed a short notice containing
  `login_url` instead, and the result is the same as for a new registration.

  Returns `{:ok, email}` in both of those cases, or `{:error, changeset}` for
  any other validation error.

  ## Examples

      iex> register_user_and_deliver_instructions(%{email: "new@example.com"}, &url/1, url)
      {:ok, "new@example.com"}

      iex> register_user_and_deliver_instructions(%{email: "taken@example.com"}, &url/1, url)
      {:ok, "taken@example.com"}

      iex> register_user_and_deliver_instructions(%{email: "bad"}, &url/1, url)
      {:error, %Ecto.Changeset{}}

  """
  def register_user_and_deliver_instructions(attrs, magic_link_url_fun, login_url)
      when is_function(magic_link_url_fun, 1) and is_binary(login_url) do
    case register_user(attrs) do
      {:ok, user} ->
        {:ok, _} = deliver_login_instructions(user, magic_link_url_fun)
        {:ok, user.email}

      {:error, %Ecto.Changeset{} = changeset} ->
        if only_email_taken_error?(changeset) do
          email = Ecto.Changeset.get_field(changeset, :email)

          if user = get_user_by_email(email) do
            {:ok, _} = UserNotifier.deliver_registration_attempt_notice(user, login_url)
          end

          {:ok, email}
        else
          {:error, changeset}
        end
    end
  end

  defp only_email_taken_error?(%Ecto.Changeset{errors: [_ | _] = errors}) do
    Enum.all?(errors, fn
      {:email, {_msg, opts}} ->
        opts[:validation] == :unsafe_unique or opts[:constraint] == :unique

      _ ->
        false
    end)
  end

  defp only_email_taken_error?(_changeset), do: false

  ## Settings

  @doc """
  Checks whether the user is in sudo mode.

  The user is in sudo mode when the last authentication was done no further
  than 20 minutes ago. The limit can be given as second argument in minutes.
  """
  def sudo_mode?(user, minutes \\ -20)

  def sudo_mode?(%User{authenticated_at: ts}, minutes) when is_struct(ts, DateTime) do
    DateTime.after?(ts, DateTime.utc_now() |> DateTime.add(minutes, :minute))
  end

  def sudo_mode?(_user, _minutes), do: false

  @doc """
  Returns an `%Ecto.Changeset{}` for changing the user email.

  See `Toile.Accounts.User.email_changeset/3` for a list of supported options.

  ## Examples

      iex> change_user_email(user)
      %Ecto.Changeset{data: %User{}}

  """
  def change_user_email(user, attrs \\ %{}, opts \\ []) do
    User.email_changeset(user, attrs, opts)
  end

  @doc """
  Updates the user email using the given token.

  If the token matches, the user email is updated and the token is deleted.
  """
  def update_user_email(user, token) do
    context = "change:#{user.email}"

    Repo.transact(fn ->
      with {:ok, query} <- UserToken.verify_change_email_token_query(token, context),
           %UserToken{sent_to: email} <- Repo.one(query),
           {:ok, user} <- Repo.update(User.email_changeset(user, %{email: email})),
           {_count, _result} <-
             Repo.delete_all(from(UserToken, where: [user_id: ^user.id, context: ^context])) do
        {:ok, user}
      else
        _ -> {:error, :transaction_aborted}
      end
    end)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for changing the user password.

  See `Toile.Accounts.User.password_changeset/3` for a list of supported options.

  ## Examples

      iex> change_user_password(user)
      %Ecto.Changeset{data: %User{}}

  """
  def change_user_password(user, attrs \\ %{}, opts \\ []) do
    User.password_changeset(user, attrs, opts)
  end

  @doc """
  Updates the user password.

  Returns a tuple with the updated user, as well as a list of expired tokens.

  ## Examples

      iex> update_user_password(user, %{password: ...})
      {:ok, {%User{}, [...]}}

      iex> update_user_password(user, %{password: "too short"})
      {:error, %Ecto.Changeset{}}

  """
  def update_user_password(user, attrs) do
    user
    |> User.password_changeset(attrs)
    |> update_user_and_delete_all_tokens()
  end

  ## Session

  @doc """
  Generates a session token.
  """
  def generate_user_session_token(user) do
    {token, user_token} = UserToken.build_session_token(user)
    Repo.insert!(user_token)
    token
  end

  @doc """
  Gets the user with the given signed token.

  If the token is valid `{user, token_inserted_at}` is returned, otherwise `nil` is returned.
  """
  def get_user_by_session_token(token) do
    {:ok, query} = UserToken.verify_session_token_query(token)
    Repo.one(query)
  end

  @doc """
  Gets the user with the given magic link token.
  """
  def get_user_by_magic_link_token(token) do
    with {:ok, query} <- UserToken.verify_magic_link_token_query(token),
         {user, _token} <- Repo.one(query) do
      user
    else
      _ -> nil
    end
  end

  @doc """
  Logs the user in by magic link.

  There are three cases to consider:

  1. The user has already confirmed their email. They are logged in
     and the magic link is expired.

  2. The user has not confirmed their email and no password is set.
     In this case, the user gets confirmed, logged in, and all tokens -
     including session ones - are expired. In theory, no other tokens
     exist but we delete all of them for best security practices.

  3. The user has not confirmed their email but a password is set.
     This cannot happen in the default implementation but may be the
     source of security pitfalls. See the "Mixing magic link and password registration" section of
     `mix help phx.gen.auth`.

  Each link works once: the token is claimed inside the transaction, so of two
  concurrent requests with the same link only one succeeds. Unknown, expired,
  already used and malformed tokens all return `{:error, :not_found}`.
  """
  def login_user_by_magic_link(token) do
    case UserToken.verify_magic_link_token_query(token) do
      {:ok, query} -> Repo.transact(fn -> claim_magic_link_token(query) end)
      :error -> {:error, :not_found}
    end
  end

  # Runs inside a transaction. `FOR UPDATE` locks both the token and the user
  # row, so a concurrent request for the same link waits for this one to commit
  # and then no longer finds the (deleted) token. Deleting the token and checking
  # the row count claims it, so only one request can ever log in with a link.
  defp claim_magic_link_token(query) do
    case Repo.one(from(q in query, lock: "FOR UPDATE")) do
      # Prevent session fixation attacks by disallowing magic links for unconfirmed users with password
      {%User{confirmed_at: nil, hashed_password: hash}, _token} when not is_nil(hash) ->
        raise """
        magic link log in is not allowed for unconfirmed users with a password set!

        This cannot happen with the default implementation, which indicates that you
        might have adapted the code to a different use case. Please make sure to read the
        "Mixing magic link and password registration" section of `mix help phx.gen.auth`.
        """

      {user, user_token} ->
        case Repo.delete_all(from(t in UserToken, where: t.id == ^user_token.id)) do
          {1, _} -> login_with_claimed_token(user, user_token)
          {0, _} -> {:error, :not_found}
        end

      nil ->
        {:error, :not_found}
    end
  end

  defp login_with_claimed_token(%User{confirmed_at: nil} = user, user_token) do
    with {:ok, user} <- user |> User.confirm_changeset() |> Repo.update() do
      {:ok, {user, [user_token | delete_all_user_tokens(user)]}}
    end
  end

  defp login_with_claimed_token(user, _user_token), do: {:ok, {user, []}}

  @doc ~S"""
  Delivers the update email instructions to the given user.

  ## Examples

      iex> deliver_user_update_email_instructions(user, current_email, &url(~p"/users/settings/confirm-email/#{&1}"))
      {:ok, %{to: ..., body: ...}}

  """
  def deliver_user_update_email_instructions(%User{} = user, current_email, update_email_url_fun)
      when is_function(update_email_url_fun, 1) do
    {encoded_token, user_token} = UserToken.build_email_token(user, "change:#{current_email}")

    Repo.insert!(user_token)
    UserNotifier.deliver_update_email_instructions(user, update_email_url_fun.(encoded_token))
  end

  @doc ~S"""
  Requests an email change for `user`, without revealing whether the new
  address already belongs to another account.

  If the new address is valid and free, a confirmation link built with
  `update_email_url_fun` is sent to it. If the only problem is that the address
  is already taken, no change link is sent; the owner of that address gets a
  short notice instead, and the result is the same as for a free address.

  Returns `{:ok, new_email}` in both of those cases, or `{:error, changeset}`
  for any other validation error (bad format, unchanged email, ...).

  ## Examples

      iex> request_user_email_change(user, %{email: "free@example.com"}, &url(~p"/users/settings/confirm-email/#{&1}"))
      {:ok, "free@example.com"}

      iex> request_user_email_change(user, %{email: "taken@example.com"}, &url(~p"/users/settings/confirm-email/#{&1}"))
      {:ok, "taken@example.com"}

      iex> request_user_email_change(user, %{email: "bad"}, &url(~p"/users/settings/confirm-email/#{&1}"))
      {:error, %Ecto.Changeset{}}

  """
  def request_user_email_change(%User{} = user, attrs, update_email_url_fun)
      when is_function(update_email_url_fun, 1) do
    changeset = change_user_email(user, attrs)

    cond do
      changeset.valid? ->
        new_user = Ecto.Changeset.apply_action!(changeset, :update)

        {:ok, _} =
          deliver_user_update_email_instructions(new_user, user.email, update_email_url_fun)

        {:ok, new_user.email}

      only_email_taken_error?(changeset) ->
        email = Ecto.Changeset.get_field(changeset, :email)

        if owner = get_user_by_email(email) do
          {:ok, _} = UserNotifier.deliver_email_change_attempt_notice(owner)
        end

        {:ok, email}

      true ->
        {:error, Map.put(changeset, :action, :update)}
    end
  end

  @doc """
  Delivers the magic link login instructions to the given user.
  """
  def deliver_login_instructions(%User{} = user, magic_link_url_fun)
      when is_function(magic_link_url_fun, 1) do
    {encoded_token, user_token} = UserToken.build_email_token(user, "login")
    Repo.insert!(user_token)
    UserNotifier.deliver_login_instructions(user, magic_link_url_fun.(encoded_token))
  end

  @doc """
  Deletes the signed token with the given context.
  """
  def delete_user_session_token(token) do
    Repo.delete_all(from(UserToken, where: [token: ^token, context: "session"]))
    :ok
  end

  ## Token helper

  defp update_user_and_delete_all_tokens(changeset) do
    Repo.transact(fn ->
      with {:ok, user} <- Repo.update(changeset) do
        {:ok, {user, delete_all_user_tokens(user)}}
      end
    end)
  end

  # Deletes every token of `user` and returns the deleted tokens, so the caller
  # can disconnect the sessions they belonged to. Must run inside a transaction.
  defp delete_all_user_tokens(user) do
    tokens_to_expire = Repo.all_by(UserToken, user_id: user.id)
    Repo.delete_all(from(t in UserToken, where: t.id in ^Enum.map(tokens_to_expire, & &1.id)))
    tokens_to_expire
  end
end
