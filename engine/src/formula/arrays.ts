// Array helpers shared by the formula modules.

/**
 * Appends every item of `items` to `target`, in order, and returns `target`.
 *
 * Use it instead of `target.push(...items)` when `items` can be arbitrarily long: a spread
 * passes each item as a call argument and throws a RangeError past the engine's argument limit.
 */
export function appendAll<T>(target: T[], items: Iterable<T>): T[] {
  for (const item of items) target.push(item);
  return target;
}
