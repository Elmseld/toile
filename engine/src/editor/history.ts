// The editor's undo/redo history (docs/adr/0008-pattern-editor.md): immutable and bounded. Each
// operation returns a new history and never mutates the old one. States are kept by reference;
// the editor's states share structure (see edits.ts), so a full history costs little.

import type { RawDefinition } from "./edits";

/** What one history entry holds: the working definition and the parameter overrides. */
export type EditorState = {
  readonly definition: RawDefinition;
  readonly parameters: Readonly<Record<string, number>>;
};

/** A bounded undo/redo history of states `T`; `past` is oldest first, `future` next first. */
export type History<T = EditorState> = {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** The most undo steps kept. */
  readonly limit: number;
};

/** The default number of undo steps kept. */
export const HISTORY_LIMIT = 100;

/** A history at `present` with nothing to undo or redo, keeping at most `limit` undo steps. */
export function createHistory<T>(present: T, limit: number = HISTORY_LIMIT): History<T> {
  return { past: [], present, future: [], limit: Math.max(0, Math.floor(limit)) };
}

/**
 * `history` with `state` as the new present: the old present can be undone, redo is cleared and
 * the oldest step is dropped beyond the limit. Pushing the present itself (the same object)
 * changes nothing.
 */
export function push<T>(history: History<T>, state: T): History<T> {
  if (state === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > history.limit ? past.slice(past.length - history.limit) : past,
    present: state,
    future: [],
    limit: history.limit,
  };
}

/** `history` one step back, or `history` itself when there is nothing to undo. */
export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1] as T,
    future: [history.present, ...history.future],
    limit: history.limit,
  };
}

/** `history` one step forward, or `history` itself when there is nothing to redo. */
export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0] as T,
    future: history.future.slice(1),
    limit: history.limit,
  };
}

/** Whether there is a step to undo. */
export function canUndo(history: History<unknown>): boolean {
  return history.past.length > 0;
}

/** Whether there is a step to redo. */
export function canRedo(history: History<unknown>): boolean {
  return history.future.length > 0;
}
