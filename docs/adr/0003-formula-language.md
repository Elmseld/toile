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
   end exclusive). No input makes them throw, including hand-built ASTs of any depth (the evaluator
   walks the tree with an explicit stack) or with malformed nodes (`invalid_result`), calls with any
   number of arguments, `null` sections from untyped callers, and a caller-supplied `lookup` that
   throws (`invalid_result` on the span of the reference). The `message`
   field is English developer text; UI text (Swedish) is built from `kind` and the structured fields.
3. **One namespace.** Measurements, parameters and formulas share one namespace of identifiers
   (`[A-Za-z_][A-Za-z0-9_]*`). A name in more than one source is a `duplicate_name` error rather than
   being resolved by precedence, which would hide mistakes. Every measurement and parameter value is
   still checked, so a non-finite value under an invalid or duplicate name also gets `invalid_value`.
4. **Dependency order, not declaration order.** Formulas are evaluated once each in topological order
   using iterative graph traversal (linear, no recursion depth proportional to the number of formulas).
   Each group of mutually dependent formulas (strongly connected component) yields one
   `circular_dependency` error naming its shortest cycle through the first-declared member
   (`a -> b -> c -> a`). Every other member of the group gets `failed_dependency`: members on that
   cycle on their reference to the next member (`b` on `c`, `c` on `a`), the rest on their first
   reference into the group. A member that already has an error (say an unknown reference) keeps
   it and gets no second one, so the cycle is headed by the first-declared member that has not
   failed, and a group whose members have all failed gets no new error. All dependants get
   `failed_dependency` too, so every failed name has an error, none gets a second one from this step, and every
   `failed_dependency` points at a name that has one. Valid formulas still
   evaluate, so `values` holds partial results on failure. This machinery lives in an
   engine-internal, name-keyed dependency graph (`src/formula/graph.ts`, `evaluateGraph`) so
   geometry (0003) can put points and formulas in one graph with the same semantics.
5. **Angles in degrees.** `sin/cos/tan` take degrees; `asin/acos/atan2` return degrees; `rad()` and
   `deg()` convert for other maths. Lengths are millimetres.
6. **Bounded input.** Formulas longer than 10 000 characters or nested deeper than 100 levels are
   `syntax` errors, so hostile input cannot overflow the stack.
7. **`Map` lookups only.** Names are resolved through `Map`s, never object property access, so names
   such as `constructor` or `__proto__` cannot reach prototype members.
8. **Injectable function table with name arguments.** `parseFormula(source, { functions })` and
   `evaluateExpression(expr, lookup, { functions })` take a function table (a `Map` of
   `FunctionSpec`, default the built-in `FUNCTIONS`, a frozen read-only table that callers extend by copying). A `FunctionSpec` either takes numbers
   (arguments are evaluated first) or, with `takes: "names"`, takes bare names that are passed to it
   unevaluated, so geometry can add `distance(A, B)`, `angle(A, B)` or `length(curve)` by building a
   table whose functions close over its own points. Name arguments are still `reference` nodes, so
   `references()` lists them as dependencies. A non-finite result from a function, or an exception
   thrown by a caller-supplied one, is an `invalid_result` error naming the function on the span of
   the call, so an injected function cannot break decision 2. A call that does not match the table is an
   `unknown_function`, `wrong_argument_count` or `invalid_argument` error, at parse time or (for
   ASTs parsed against another table or built by hand) at evaluation time. Rejected: a separate
   point-reference node type in the AST (more grammar for the same result) and a global, mutable
   function registry (not pure). `evaluateFormulas` keeps the built-in table; geometry composes the
   lower-level functions with `evaluateGraph` instead.

## Consequences
- The editor can show every problem with a position and recover by drawing what evaluated.
- The grammar has no constants (`pi`), no exponent operator and no `.5` or `1e3` number forms; adding
  them later is a parser/function-table change only.
- Switching trig to radians would only change `functions.ts`, its tests and this ADR.
- `evaluateExpression` takes a lookup function and a function table, so geometry (0003) can resolve
  point distances and angles through the same evaluator without changing the parser.
