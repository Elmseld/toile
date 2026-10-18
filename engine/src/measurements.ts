// The body measurements a profile can hold. The list lives in measurements.json, which the Phoenix
// app reads too (docs/adr/0005-measurement-keys.md), so both sides agree on the names.

import keys from "./measurements.json";

/** Measurement keys a profile can hold, in display order (docs/adr/0005-measurement-keys.md). */
export const MEASUREMENT_KEYS: readonly string[] = Object.freeze([...keys]);

// A Set rather than `in` on an object, so names like "constructor" or "__proto__" are not keys.
const KEY_SET: ReadonlySet<string> = new Set(MEASUREMENT_KEYS);

/** Whether `name` is one of the catalogue measurement keys. */
export function isMeasurementKey(name: string): boolean {
  return KEY_SET.has(name);
}
