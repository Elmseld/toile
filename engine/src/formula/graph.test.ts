import { describe, expect, test } from "bun:test";
import type { FormulaError } from "./errors";
import { components, type DependencyGraph, type Edge, evaluateGraph, shortestCycleThrough } from "./graph";

// Builds a graph from `{ node: "dep1 dep2" }`; each edge's span is its index in that list.
function graph(nodes: Record<string, string>): DependencyGraph {
  return new Map(
    Object.entries(nodes).map(([name, deps]) => [
      name,
      deps
        .split(" ")
        .filter((dep) => dep !== "")
        .map((dep, i): Edge => ({ name: dep, span: { start: i, end: i + 1 } })),
    ]),
  );
}

function run(g: DependencyGraph, failed: string[] = [], failing: string[] = []) {
  const names = [...g.keys()];
  const evaluated: string[] = [];
  const errors = evaluateGraph(g, {
    position: (name) => names.indexOf(name),
    failed: new Set(failed),
    evaluate: (name): FormulaError | null => {
      evaluated.push(name);
      return failing.includes(name)
        ? { kind: "division_by_zero", name, span: { start: 0, end: 0 }, message: "x" }
        : null;
    },
  });
  return { errors, evaluated };
}

describe("components", () => {
  test("come out dependencies first", () => {
    expect(components(graph({ c: "b", b: "a", a: "" }))).toEqual([["a"], ["b"], ["c"]]);
  });

  test("edges to names outside the graph are not followed", () => {
    expect(components(graph({ a: "m", b: "a m" }))).toEqual([["a"], ["b"]]);
  });

  test("a cycle is one component", () => {
    expect(components(graph({ a: "b", b: "a", c: "a" })).map((c) => [...c].sort())).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });
});

describe("shortestCycleThrough", () => {
  test("finds the shortest cycle, closed on the head", () => {
    const g = graph({ a: "b", b: "c a", c: "a" });
    expect(shortestCycleThrough("a", new Set(["a", "b", "c"]), g)).toEqual(["a", "b", "a"]);
  });

  test("is null for a node that is not on a cycle", () => {
    expect(shortestCycleThrough("a", new Set(["a"]), graph({ a: "m" }))).toBeNull();
  });
});

describe("evaluateGraph", () => {
  test("evaluates every node once, dependencies first", () => {
    const { errors, evaluated } = run(graph({ c: "b a", b: "a", a: "m" }));
    expect(errors).toEqual([]);
    expect(evaluated).toEqual(["a", "b", "c"]);
  });

  test("a failed name fails its dependants, which are not evaluated", () => {
    const { errors, evaluated } = run(graph({ a: "m", b: "a", c: "x" }), ["m"]);
    expect(evaluated).toEqual(["c"]);
    expect(errors).toEqual([
      expect.objectContaining({ kind: "failed_dependency", name: "a", dependency: "m" }),
      expect.objectContaining({ kind: "failed_dependency", name: "b", dependency: "a" }),
    ]);
  });

  test("an evaluation error fails the dependants", () => {
    const { errors, evaluated } = run(graph({ b: "a", a: "" }), [], ["a"]);
    expect(evaluated).toEqual(["a"]);
    expect(errors.map((e) => [e.kind, e.name])).toEqual([
      ["division_by_zero", "a"],
      ["failed_dependency", "b"],
    ]);
  });

  test("every member of a cycle group gets an error and none is evaluated", () => {
    // a -> b -> c -> a is the cycle; d is in the group (d -> a, b -> d) but not on that cycle.
    const { errors, evaluated } = run(graph({ a: "b", b: "c d", c: "a", d: "a", e: "c" }));
    expect(evaluated).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "circular_dependency", name: "a", cycle: ["a", "b", "c", "a"] }),
        expect.objectContaining({ kind: "failed_dependency", name: "b", dependency: "c" }),
        expect.objectContaining({ kind: "failed_dependency", name: "c", dependency: "a" }),
        expect.objectContaining({ kind: "failed_dependency", name: "d", dependency: "a" }),
        expect.objectContaining({ kind: "failed_dependency", name: "e", dependency: "c" }),
      ]),
    );
    expect(errors).toHaveLength(5);
  });

  test("a member that already failed keeps its error, the head still gets the cycle", () => {
    const { errors } = run(graph({ a: "b", b: "a" }), ["a", "b"]);
    expect(errors).toEqual([expect.objectContaining({ kind: "circular_dependency", name: "a" })]);
  });

  test("does not mutate the failed set it is given", () => {
    const failed = new Set(["m"]);
    evaluateGraph(graph({ a: "m" }), { position: () => 0, failed, evaluate: () => null });
    expect([...failed]).toEqual(["m"]);
  });
});
