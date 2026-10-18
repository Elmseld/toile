defmodule ToileWeb.CentimetersTest do
  use ExUnit.Case, async: true

  alias ToileWeb.Centimeters

  doctest Centimeters

  describe "parse/1" do
    test "accepts both decimal separators and whole centimetres" do
      assert Centimeters.parse("72.5") == {:ok, 725}
      assert Centimeters.parse("72,5") == {:ok, 725}
      assert Centimeters.parse("72") == {:ok, 720}
      assert Centimeters.parse(" 72 ") == {:ok, 720}
    end

    test "returns the limits in millimetres" do
      assert Centimeters.parse("300") == {:ok, 3000}
      assert Centimeters.parse("0.1") == {:ok, 1}
      assert Centimeters.parse("0") == {:ok, 0}
    end

    test "keeps the sign so the range check can report it" do
      assert Centimeters.parse("-5") == {:ok, -50}
      assert Centimeters.parse("-0,5") == {:ok, -5}
      assert Centimeters.parse("+5") == {:ok, 50}
    end

    test "rejects more than one decimal, non-numbers and empty input" do
      for input <- ["72.55", "72,", ".5", "abc", "", "  ", "1e3", "7 2", "72.5cm", "1,2,3"] do
        assert Centimeters.parse(input) == :error, "expected #{inspect(input)} to be rejected"
      end
    end
  end

  describe "format/1" do
    test "shows centimetres with exactly one decimal" do
      assert Centimeters.format(725) == "72.5"
      assert Centimeters.format(720) == "72.0"
      assert Centimeters.format(1) == "0.1"
      assert Centimeters.format(3000) == "300.0"
      assert Centimeters.format(-50) == "-5.0"
    end
  end

  describe "to_mm_params/1" do
    test "converts parseable catalogue values to millimetres" do
      assert Centimeters.to_mm_params(%{"waist" => "72,5", "hip" => "100"}) ==
               %{"waist" => 725, "hip" => 1000}
    end

    test "keeps blank and unparseable values as typed" do
      assert Centimeters.to_mm_params(%{"waist" => "", "hip" => "72.55", "neck" => "abc"}) ==
               %{"waist" => "", "hip" => "72.55", "neck" => "abc"}
    end

    test "leaves unknown keys and non-string values untouched" do
      params = %{"evil" => "5", "waist" => %{"nested" => "1"}, "hip" => nil}

      assert Centimeters.to_mm_params(params) == params
    end
  end

  describe "input_value/1" do
    test "formats millimetres, keeps strings and blanks nil" do
      assert Centimeters.input_value(725) == "72.5"
      assert Centimeters.input_value("72.55") == "72.55"
      assert Centimeters.input_value(nil) == ""
    end
  end
end
