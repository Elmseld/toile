// Dependency graph evaluation shared by everything that evaluates named values in dependency
// order (formulas now, points and formulas together in geometry). Engine-internal: not exported
// from the package entry point.

import {
  circularDependencyError,
  failedDependencyError,
  type FormulaError,
  type Span,
} from "./errors";

/** A reference from one node to a name, with the span of that reference in the node's source. */
export type Edge = { name: string; span: Span };

/**
 * Nodes keyed by name, each with its references in order of appearance. References to names that
 * are not nodes (inputs such as measurements) are not followed for ordering, but a failed one
 * still fails the node.
 */
export type DependencyGraph = ReadonlyMap<string, readonly Edge[]>;

export type EvaluateGraphOptions = {
  /** Declaration position of a name; the first-declared member of a cycle group heads it. */
  position: (name: string) => number;
  /** Names (nodes or not) that already have an error. Not mutated. */
  failed: ReadonlySet<string>;
  /**
   * Evaluates one node and returns its error, or `null` on success. Called at most once per node,
   * after all its dependencies, and only when none of its references has failed.
   */
  evaluate: (name: string) => FormulaError | null;
};

/**
 * Evaluates every node of `graph` in dependency order and returns the new errors, in no particular
 * order. The semantics (ADR 0003):
 *
 * - Each strongly connected group of nodes (a cycle, or several sharing members) gives one
 *   `circular_dependency` error, naming the shortest cycle through its first-declared member and
 *   spanning that member's reference to the next. Every other member of the group gets
 *   `failed_dependency`: members on that cycle on their reference to the next member of the cycle,
 *   the rest on their first reference into the group. So every member has an error, and every
 *   `failed_dependency` points at a name that has one.
 * - A node with a reference to a failed name gets `failed_dependency` on the first such reference.
 * - Members that already failed keep their error and get no second one. The head is therefore the
 *   first-declared member that has not failed; a group whose members have all failed gets no new
 *   errors.
 *
 * Iterative and linear in nodes plus edges, so the call stack does not grow with the graph.
 */
export function evaluateGraph(
  graph: DependencyGraph,
  options: EvaluateGraphOptions,
): FormulaError[] {
  const { position, evaluate } = options;
  const errors: FormulaError[] = [];
  const failed = new Set(options.failed);
  const fail = (error: FormulaError): void => {
    errors.push(error);
    failed.add(error.name);
  };

  for (const group of components(graph)) {
    const cycleErrors = groupErrors(group, graph, position, failed);
    if (cycleErrors !== null) {
      for (const error of cycleErrors) fail(error);
      for (const member of group) failed.add(member);
      continue;
    }

    // A single node that does not reference itself.
    const [name] = group;
    if (name === undefined || failed.has(name)) continue;
    const failedRef = graph.get(name)?.find((edge) => failed.has(edge.name));
    if (failedRef !== undefined) {
      fail(failedDependencyError(name, failedRef.name, failedRef.span));
      continue;
    }
    const error = evaluate(name);
    if (error !== null) fail(error);
  }

  return errors;
}

/**
 * The errors for a cycle group, or `null` when `group` is a single node, not yet failed, that is
 * not on a cycle. The head is the first-declared member that has not failed yet.
 */
function groupErrors(
  group: readonly string[],
  graph: DependencyGraph,
  position: (name: string) => number,
  failed: ReadonlySet<string>,
): FormulaError[] | null {
  const candidates = group.filter((member) => !failed.has(member));
  // Every member already has an error (for a single node, the caller would skip it anyway).
  if (candidates.length === 0) return [];
  const head = candidates.reduce((a, b) => (position(b) < position(a) ? b : a));
  const members = new Set(group);
  const cycle = shortestCycleThrough(head, members, graph);
  if (cycle === null) return null;

  const edgeTo = (from: string, to: string): Edge | undefined =>
    graph.get(from)?.find((edge) => edge.name === to);

  const errors = [circularDependencyError(cycle, edgeTo(head, cycle[1] ?? head)?.span ?? NO_SPAN)];

  // Next member along the cycle, for every member on it except the head.
  const next = new Map<string, string>();
  for (let i = 1; i < cycle.length - 1; i++) {
    const member = cycle[i];
    const following = cycle[i + 1];
    if (member !== undefined && following !== undefined) next.set(member, following);
  }

  for (const member of group) {
    if (member === head || failed.has(member)) continue;
    const target = next.get(member);
    const edge =
      target === undefined
        ? graph.get(member)?.find((e) => members.has(e.name))
        : edgeTo(member, target);
    // Every member of a group of two or more has a reference into the group.
    if (edge !== undefined) errors.push(failedDependencyError(member, edge.name, edge.span));
  }

  return errors;
}

const NO_SPAN: Span = { start: 0, end: 0 };

type Frame = { name: string; next: number };

/**
 * Splits `graph` into strongly connected components with an iterative Tarjan search, so the call
 * stack does not grow with the number of nodes. Components come out dependencies first, which is
 * the evaluation order. Only edges to nodes of `graph` are followed. Linear in nodes + edges.
 */
export function components(graph: DependencyGraph): string[][] {
  const result: string[][] = [];
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const componentStack: string[] = [];
  const onComponentStack = new Set<string>();

  const visit = (name: string, frames: Frame[]): void => {
    index.set(name, index.size);
    low.set(name, index.size - 1);
    componentStack.push(name);
    onComponentStack.add(name);
    frames.push({ name, next: 0 });
  };
  const lower = (name: string, candidate: number): void => {
    if (candidate < (low.get(name) ?? Infinity)) low.set(name, candidate);
  };

  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const frames: Frame[] = [];
    visit(root, frames);

    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const edges = graph.get(frame.name) ?? [];
      const edge = edges[frame.next];
      if (edge !== undefined) {
        frame.next++;
        if (!graph.has(edge.name)) continue;
        const edgeIndex = index.get(edge.name);
        if (edgeIndex === undefined) visit(edge.name, frames);
        else if (onComponentStack.has(edge.name)) lower(frame.name, edgeIndex);
        continue;
      }

      frames.pop();
      const frameLow = low.get(frame.name) ?? Infinity;
      const parent = frames.at(-1);
      if (parent !== undefined) lower(parent.name, frameLow);

      if (frameLow === index.get(frame.name)) {
        const component: string[] = [];
        for (let member = componentStack.pop(); member !== undefined; member = componentStack.pop()) {
          onComponentStack.delete(member);
          component.push(member);
          if (member === frame.name) break;
        }
        result.push(component);
      }
    }
  }

  return result;
}

/**
 * The shortest cycle through `head` within `members` (a strongly connected component), found
 * with a breadth-first search following edges in order of appearance. Returned closed, e.g.
 * `["a", "b", "a"]`, or `null` when `head` is not on a cycle (a single node that does not
 * reference itself).
 */
export function shortestCycleThrough(
  head: string,
  members: ReadonlySet<string>,
  graph: DependencyGraph,
): string[] | null {
  const previous = new Map<string, string>();
  const queue = [head];

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] ?? head;
    for (const edge of graph.get(current) ?? []) {
      if (edge.name === head) {
        const path = [current];
        for (let node = previous.get(current); node !== undefined; node = previous.get(node)) {
          path.push(node);
        }
        path.reverse();
        // `path` runs from `head` to the member that references it.
        return [...path, head];
      }
      if (members.has(edge.name) && edge.name !== head && !previous.has(edge.name)) {
        previous.set(edge.name, current);
        queue.push(edge.name);
      }
    }
  }

  return null;
}
