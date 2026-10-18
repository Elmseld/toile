// The references of a formula with the kind of element each must name.

import type { Span } from "../formula/errors";
import type { FunctionTable } from "../formula/functions";
import type { Expr } from "../formula/parser";
import { NAME_ARGUMENT_KINDS } from "./functions";

/** A reference in a formula and what it must name. */
export type ClassifiedReference = { name: string; span: Span; kind: "value" | "point" | "curve" };

/**
 * Every reference in `expr`, in source order with duplicates, each with the kind it must have:
 * the arguments of a geometry function that takes names in `functions` (`distance`, `angle`:
 * points, `length`: a curve) and `"value"` for every other reference. Walks with an explicit
 * stack, so nesting depth never matters.
 */
export function classifyReferences(expr: Expr, functions: FunctionTable): ClassifiedReference[] {
  const result: ClassifiedReference[] = [];
  const stack: Expr[] = [expr];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    switch (node.type) {
      case "number":
        break;
      case "reference":
        result.push({ name: node.name, span: node.span, kind: "value" });
        break;
      case "negate":
        stack.push(node.operand);
        break;
      case "binary":
        // Right first, so the left operand is popped (and listed) first.
        stack.push(node.right, node.left);
        break;
      case "call": {
        const kind = NAME_ARGUMENT_KINDS.get(node.function);
        if (kind !== undefined && functions.get(node.function)?.takes === "names") {
          for (const arg of node.args) {
            if (arg.type === "reference") result.push({ name: arg.name, span: arg.span, kind });
          }
          break;
        }
        for (let i = node.args.length - 1; i >= 0; i--) {
          const arg = node.args[i];
          if (arg !== undefined) stack.push(arg);
        }
        break;
      }
      default: {
        // A new node type must be classified here, or its references would be missed silently.
        const unhandled: never = node;
        return unhandled;
      }
    }
  }

  return result;
}
