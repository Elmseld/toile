import { describe, expect, test } from "bun:test";
import { canRedo, canUndo, createHistory, HISTORY_LIMIT, push, redo, undo } from "./index";

function pushAll(count: number, limit?: number) {
  let history = createHistory(0, limit);
  for (let i = 1; i <= count; i++) history = push(history, i);
  return history;
}

describe("history", () => {
  test("starts with nothing to undo or redo", () => {
    const history = createHistory("a");
    expect(history.present).toBe("a");
    expect(history.limit).toBe(HISTORY_LIMIT);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  test("60 pushes allow 60 undos", () => {
    let history = pushAll(60);
    for (let i = 59; i >= 0; i--) {
      history = undo(history);
      expect(history.present).toBe(i);
    }
    expect(canUndo(history)).toBe(false);
  });

  test("drops the oldest entry at the limit", () => {
    const history = pushAll(105);
    expect(history.past).toHaveLength(100);
    expect(history.past[0]).toBe(5);

    const small = pushAll(5, 3);
    expect(small.past).toEqual([2, 3, 4]);
  });

  test("redo after undo restores the state, and a push after undo clears redo", () => {
    let history = pushAll(3);
    history = undo(undo(history));
    expect(history.present).toBe(1);
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history.present).toBe(2);
    expect(history.future).toEqual([3]);

    history = push(history, 10);
    expect(canRedo(history)).toBe(false);
    expect(history.past).toEqual([0, 1, 2]);
  });

  test("pushing the present is a no-op, and nothing is mutated", () => {
    const state = { definition: {}, parameters: {} };
    const history = createHistory(state);
    expect(push(history, state)).toBe(history);

    const next = push(history, { definition: {}, parameters: { ease_hip: 50 } });
    expect(history.past).toEqual([]);
    expect(next.past).toEqual([state]);
    undo(next);
    expect(next.past).toEqual([state]);
  });

  test("a limit of zero keeps no undo steps", () => {
    expect(canUndo(pushAll(3, 0))).toBe(false);
  });
});
