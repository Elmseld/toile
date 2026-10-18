# 0003: Formula language

Status: accepted (ticket 0002)

## Context
Every value in a parametric pattern comes from formulas such as `waist / 4 + ease_waist`. Users type
these into the editor, so the engine evaluates untrusted input on the hot path (the editor recalculates
immediately). Ticket 0003 (geometry) and the editor (0008) build on the API and error model chosen here.

## Decision
1. **Custom parser, never `eval`.** A hand-written tokenizer and recursive-descent parser produce an AST
   that a pure evaluator walks. No `eval`, `Function` or dynamic `import` in `engine/src` (a test checks
   the source). Rejected: `eval`/`new Function` (code injection) and a parsing dependency (not needed
   for this small grammar).
2. **Errors are values, never thrown.** `parseFormula`, `evaluateExpression` and `evaluateFormulas`
   return structured errors with `kind`, `name` and a `span` (0-based offsets into the formula source,
   end exclusive). No input makes them throw. The `message` field is English developer text; UI text
   (Swedish) is built from `kind` and the structured fields.
3. **One namespace.** Measurements, parameters and formulas share one namespace of identifiers
   (`[A-Za-z_][A-Za-z0-9_]*`). A name in more than one source is a `duplicate_name` error rather than
   being resolved by precedence, which would hide mistakes.
4. **Dependency order, not declaration order.** Formulas are evaluated once each in topological order
   using iterative graph traversal (linear, no recursion depth proportional to the number of formulas).
   Each group of mutually dependent formulas (strongly connected component) yields one
   `circular_dependency` error naming its shortest cycle through the first-declared member
   (`a -> b -> c -> a`); the group's other members and all dependants get `failed_dependency`.
   Valid formulas still evaluate, so `values` holds partial results on failure.
5. **Angles in degrees.** `sin/cos/tan` take degrees; `asin/acos/atan2` return degrees; `rad()` and
   `deg()` convert for other maths. Lengths are millimetres.
6. **Bounded input.** Formulas longer than 10 000 characters or nested deeper than 100 levels are
   `syntax` errors, so hostile input cannot overflow the stack.
7. **`Map` lookups only.** Names are resolved through `Map`s, never object property access, so names
   such as `constructor` or `__proto__` cannot reach prototype members.

## Consequences
- The editor can show every problem with a position and recover by drawing what evaluated.
- The grammar has no constants (`pi`), no exponent operator and no `.5` or `1e3` number forms; adding
  them later is a parser/function-table change only.
- Switching trig to radians would only change `functions.ts`, its tests and this ADR.
- `evaluateExpression` takes a lookup function, so geometry (0003) can resolve point distances and
  angles through the same evaluator.
