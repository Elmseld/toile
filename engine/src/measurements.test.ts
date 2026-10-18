import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMeasurementKey, MEASUREMENT_KEYS } from "./index";

const EXPECTED = [
  "bust",
  "waist",
  "hip",
  "neck",
  "shoulder_width",
  "back_width",
  "chest_width",
  "back_length",
  "front_length",
  "bust_height",
  "bust_distance",
  "hip_height",
  "skirt_length",
  "arm_length",
  "upper_arm",
  "wrist",
  "height",
];

test("MEASUREMENT_KEYS holds the catalogue keys in display order", () => {
  expect([...MEASUREMENT_KEYS]).toEqual(EXPECTED);
});

test("measurement keys are unique", () => {
  expect(new Set(MEASUREMENT_KEYS).size).toBe(MEASUREMENT_KEYS.length);
});

test("every measurement key is a snake_case formula identifier", () => {
  for (const key of MEASUREMENT_KEYS) {
    expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  }
});

test("MEASUREMENT_KEYS is frozen", () => {
  expect(Object.isFrozen(MEASUREMENT_KEYS)).toBe(true);
});

test("isMeasurementKey accepts catalogue keys only", () => {
  expect(isMeasurementKey("waist")).toBe(true);
  expect(isMeasurementKey("hip_height")).toBe(true);
  expect(isMeasurementKey("foo")).toBe(false);
  expect(isMeasurementKey("constructor")).toBe(false);
  expect(isMeasurementKey("__proto__")).toBe(false);
  expect(isMeasurementKey("toString")).toBe(false);
  expect(isMeasurementKey("")).toBe(false);
});

test("the example pattern uses only catalogue measurement keys", () => {
  const path = join(import.meta.dir, "..", "examples", "rectangle-with-dart.json");
  const example = JSON.parse(readFileSync(path, "utf8")) as { measurements: string[] };
  expect(example.measurements.length).toBeGreaterThan(0);
  for (const name of example.measurements) {
    expect(isMeasurementKey(name)).toBe(true);
  }
});
