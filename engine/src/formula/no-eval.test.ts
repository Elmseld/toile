import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");
const FORBIDDEN = /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("the engine never uses eval, Function or dynamic import", () => {
  const files = sourceFiles(SRC);
  expect(files.length).toBeGreaterThan(0);
  expect(files).toContain(join(SRC, "formula", "parser.ts"));
  const offenders = files.filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")));
  expect(offenders).toEqual([]);
});
