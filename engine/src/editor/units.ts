// Display units of pattern parameters, for the editor's parameter panel
// (docs/adr/0008-pattern-editor.md). Definitions store lengths in mm and angles in degrees; the
// panel shows lengths in cm, the way the measurement forms do.

/**
 * How a parameter is shown: `length` (stored mm, shown cm), `angle` (degrees), `angle_per_length`
 * (stored degrees per mm, shown degrees per cm) or a plain `number`.
 */
export type ParameterUnit = "length" | "angle" | "angle_per_length" | "number";

/** The largest absolute parameter value the app stores. */
export const MAX_PARAMETER = 1_000_000;

/** Stored value = display value * factor. */
const FACTOR: Readonly<Record<ParameterUnit, number>> = {
  length: 10,
  angle: 1,
  angle_per_length: 0.1,
  number: 1,
};

/**
 * Decimals kept in the display unit. Two for cm, so a stored 12.5 mm (1,25 cm) survives a round
 * trip; three for degrees per cm, so a stored 0.125 degrees per mm does.
 */
const DECIMALS: Readonly<Record<ParameterUnit, number>> = {
  length: 2,
  angle: 2,
  angle_per_length: 3,
  number: 3,
};

/** A number such as `4`, `-4.5`, `4,5`, `.5` or `4.` (either decimal separator). */
const NUMBER_FORMAT = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `+ 0` turns -0 into 0.
  return Math.round(value * factor) / factor + 0;
}

function unitOf(unit: string): ParameterUnit {
  return Object.hasOwn(FACTOR, unit) ? (unit as ParameterUnit) : "number";
}

/** The stored `value` in `unit`'s display unit, rounded to its display decimals. */
export function toDisplay(value: number, unit: ParameterUnit): number {
  const u = unitOf(unit);
  return roundTo(value / FACTOR[u], DECIMALS[u]);
}

/**
 * The stored value for the typed `text` in `unit`'s display unit, rounded to its display
 * decimals, or `null` when `text` is not a number (or is empty) or the value is larger than
 * `MAX_PARAMETER`. Accepts `.` or `,` as decimal separator and surrounding whitespace.
 */
export function fromDisplay(text: string, unit: ParameterUnit): number | null {
  const trimmed = text.trim();
  if (!NUMBER_FORMAT.test(trimmed)) return null;
  const u = unitOf(unit);
  const shown = roundTo(Number(trimmed.replace(",", ".")), DECIMALS[u]);
  // Rounded again so that the conversion leaves no float noise (0.1 * 1.2 = 0.12000000000000001).
  const stored = roundTo(shown * FACTOR[u], DECIMALS[u] + 1);
  return Number.isFinite(stored) && Math.abs(stored) <= MAX_PARAMETER ? stored : null;
}

/** `value` as text with `decimalSeparator` (`"."` or `","`), without trailing zeros. */
export function formatDisplay(value: number, decimalSeparator: string): string {
  return String(value + 0).replace(".", decimalSeparator);
}
