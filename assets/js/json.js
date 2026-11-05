// JSON helpers shared by the hooks and the editor.

/** `text` decoded as JSON, or `fallback` when it is missing or not valid JSON. */
export function parseJSON(text, fallback) {
  try {
    return JSON.parse(text ?? "")
  } catch {
    return fallback
  }
}

/** The number of bytes `value` takes encoded as JSON in UTF-8. */
export function encodedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length
}
