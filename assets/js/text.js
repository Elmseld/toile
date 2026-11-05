// Text helpers shared by the hooks and the editor.

/** `template` with every `%{key}` replaced by `values[key]` (own keys only). */
export function fill(template, values = {}) {
  return String(template ?? "").replace(/%\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}
