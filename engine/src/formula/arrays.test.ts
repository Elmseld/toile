import { describe, expect, test } from "bun:test";
import { appendAll } from "./arrays";

describe("appendAll", () => {
  test("appends in order and returns the target", () => {
    const target = [1, 2];
    expect(appendAll(target, [3, 4])).toBe(target);
    expect(target).toEqual([1, 2, 3, 4]);
  });

  test("appends more items than the engine allows call arguments", () => {
    // 2 000 000 is above the argument limits of JavaScriptCore (Bun) and V8, where
    // `push(...items)` throws a RangeError.
    const items = new Array<number>(2_000_000).fill(7);
    const target: number[] = [0];
    appendAll(target, items);
    expect(target.length).toBe(2_000_001);
    expect(target[2_000_000]).toBe(7);
  });
});
