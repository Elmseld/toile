// The single namespace of named values (ADR 0003) and pattern elements (ADR 0004): declaration
// order, the sources each name is declared in, and the errors for invalid or duplicate names.
// Engine-internal: not exported from the package entry point.

import {
  type DuplicateNameError,
  duplicateNameError,
  type InvalidNameError,
  invalidNameError,
} from "./errors";
import { isIdentifier } from "./lexer";

/**
 * Names in declaration order, each with every source (`S`, such as `"measurement"`) it is declared
 * in. Declare every name first, then read. Keys are only ever used as `Map` keys, so names such as
 * `__proto__` are safe.
 */
export class Namespace<S extends string> {
  private readonly index = new Map<string, number>();
  private readonly sources = new Map<string, S[]>();

  /** Records that `name` is declared in `source`; its position is that of its first declaration. */
  declare(name: string, source: S): void {
    if (!this.index.has(name)) this.index.set(name, this.index.size);
    const list = this.sources.get(name);
    if (list === undefined) this.sources.set(name, [source]);
    else list.push(source);
  }

  /** The declaration position of `name`, `Infinity` for an undeclared name (sorted last). */
  position(name: string): number {
    return this.index.get(name) ?? Infinity;
  }

  /** Every source `name` is declared in, in order, or `undefined` when it is not declared. */
  sourcesOf(name: string): readonly S[] | undefined {
    return this.sources.get(name);
  }

  /** Every declared name once, in declaration order. */
  names(): IterableIterator<string> {
    return this.index.keys();
  }

  /**
   * In declaration order: `invalid_name` once per source for a name that is not an identifier,
   * else `duplicate_name` (with every source) for a name declared more than once.
   */
  nameErrors(): (InvalidNameError<S> | DuplicateNameError<S>)[] {
    const errors: (InvalidNameError<S> | DuplicateNameError<S>)[] = [];
    for (const [name, list] of this.sources) {
      if (!isIdentifier(name)) {
        for (const source of list) errors.push(invalidNameError(name, source));
      } else if (list.length > 1) {
        errors.push(duplicateNameError(name, [...list]));
      }
    }
    return errors;
  }

  /**
   * Sorts `errors` in place by the declaration position of their `name` and returns them. The sort
   * is stable, so the errors of one name keep the order in which they were found.
   */
  sortByPosition<E extends { name: string }>(errors: E[]): E[] {
    return errors.sort((a, b) => this.position(a.name) - this.position(b.name));
  }

  /**
   * The entries of `values` whose name is declared, as a plain record in declaration order.
   * `fromEntries` defines own data properties, so names such as `__proto__` are stored safely.
   */
  inOrder<T>(values: ReadonlyMap<string, T>): Record<string, T> {
    const entries: [string, T][] = [];
    for (const name of this.index.keys()) {
      const value = values.get(name);
      if (value !== undefined) entries.push([name, value]);
    }
    return Object.fromEntries(entries);
  }
}
