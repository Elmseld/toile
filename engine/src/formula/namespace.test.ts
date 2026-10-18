import { describe, expect, test } from "bun:test";
import { Namespace } from "./namespace";

type Source = "a" | "b";

function namespaceOf(declarations: [string, Source][]): Namespace<Source> {
  const namespace = new Namespace<Source>();
  for (const [name, source] of declarations) namespace.declare(name, source);
  return namespace;
}

describe("Namespace", () => {
  test("positions follow the first declaration; undeclared names sort last", () => {
    const namespace = namespaceOf([
      ["x", "a"],
      ["y", "b"],
      ["x", "b"],
    ]);
    expect([...namespace.names()]).toEqual(["x", "y"]);
    expect(namespace.position("x")).toBe(0);
    expect(namespace.position("y")).toBe(1);
    expect(namespace.position("z")).toBe(Infinity);
    expect(namespace.sourcesOf("x")).toEqual(["a", "b"]);
    expect(namespace.sourcesOf("z")).toBeUndefined();
  });

  test("invalid names once per source, duplicates once with every source, in declaration order", () => {
    const namespace = namespaceOf([
      ["dup", "a"],
      ["1x", "a"],
      ["ok", "b"],
      ["1x", "b"],
      ["dup", "b"],
    ]);
    expect(namespace.nameErrors()).toEqual([
      { kind: "duplicate_name", name: "dup", sources: ["a", "b"], message: expect.any(String) },
      { kind: "invalid_name", name: "1x", source: "a", message: expect.any(String) },
      { kind: "invalid_name", name: "1x", source: "b", message: expect.any(String) },
    ]);
  });

  test("sortByPosition is stable and inOrder keeps declaration order, also for __proto__", () => {
    const namespace = namespaceOf([
      ["__proto__", "a"],
      ["b", "a"],
    ]);
    const errors = [
      { name: "zz", id: 1 },
      { name: "b", id: 2 },
      { name: "__proto__", id: 3 },
      { name: "b", id: 4 },
    ];
    expect(namespace.sortByPosition(errors).map((error) => error.id)).toEqual([3, 2, 4, 1]);
    const record = namespace.inOrder(
      new Map([
        ["b", 2],
        ["__proto__", 1],
        ["undeclared", 3],
      ]),
    );
    expect(Object.entries(record)).toEqual([
      ["__proto__", 1],
      ["b", 2],
    ]);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
