// Panels: the DOM of the editor aside (#pattern-editor, docs/adr/0008-pattern-editor.md).
//
// HEEx renders the aside once (phx-update="ignore"): the undo/redo buttons, the save status, the
// alert, the point select with an empty #point-details, and one row per parameter. This module
// fills and updates it; PatternEditor decides what to show. All text comes from the hook's
// `data-texts` (ToileWeb.EditorTexts), never from here.

import {formatDisplay, pointFields, toDisplay} from "../../../engine/src/index"

/** `template` with every `%{key}` replaced by `values[key]`. */
export function fill(template, values = {}) {
  return String(template ?? "").replace(/%\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}

/** The name an engine error's text mentions: the reference, function or dependency it is about. */
function errorSubject(error) {
  return error.reference ?? error.function ?? error.dependency ?? error.name ?? ""
}

/** The UI text for an engine error, or the generic text for a kind without one. */
export function errorText(texts, error) {
  const template = (error && texts.errors?.[error.kind]) ?? texts.errors?.generic ?? ""
  return fill(template, {name: error ? errorSubject(error) : ""})
}

function element(name, attributes = {}, text = null) {
  const node = document.createElement(name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  if (text !== null) node.textContent = text
  return node
}

/** A length in mm as cm text with the locale's decimal separator. */
function centimetres(mm, texts) {
  return formatDisplay(toDisplay(mm, "length"), texts.decimal_separator ?? ".")
}

function referenceText(value, kind, texts) {
  if (kind === "line" && Array.isArray(value)) return value.map(String).join(" – ")
  if (kind === "which") return texts.which?.[value] ?? String(value ?? "")
  return String(value ?? "")
}

export class Panels {
  constructor(aside, texts) {
    this.aside = aside
    this.texts = texts
    this.undoButton = aside.querySelector("#undo-button")
    this.redoButton = aside.querySelector("#redo-button")
    this.status = aside.querySelector("#save-status")
    this.alert = aside.querySelector("#editor-alert")
    this.pointSelect = aside.querySelector("#point-select")
    this.details = aside.querySelector("#point-details")
  }

  setHistory(canUndo, canRedo) {
    if (this.undoButton) this.undoButton.disabled = !canUndo
    if (this.redoButton) this.redoButton.disabled = !canRedo
  }

  /** Shows the save status: "saving", "saved", "failed" or null for none. */
  setStatus(status) {
    if (!this.status) return
    this.status.textContent = status ? (this.texts.status?.[status] ?? "") : ""
    this.status.classList.toggle("text-error", status === "failed")
  }

  /** Shows `text` in #editor-alert, or clears it for null. */
  setAlert(text) {
    if (this.alert) this.alert.textContent = text ?? ""
  }

  /**
   * Fills #point-details for the raw point `point` (or empties it for none): its name, what its
   * operation does, its reference fields read-only, an input per formula field, and its offset
   * with the button that removes it. The formula inputs carry `data-field`.
   */
  renderPoint(point) {
    if (this.pointSelect) this.pointSelect.value = point?.name ?? ""
    if (!this.details) return
    this.details.replaceChildren()
    if (!point) return

    const texts = this.texts
    this.details.appendChild(
      element("p", {id: "point-name", class: "font-mono font-semibold break-all"}, point.name),
    )
    const op = typeof point.op === "string" ? point.op : ""
    this.details.appendChild(
      element("p", {id: "point-op", class: "text-sm"}, texts.ops?.[op] ?? op),
    )

    const fields = pointFields(point)
    const references = fields.filter(({kind}) => kind !== "formula")
    if (references.length > 0) {
      const list = element("dl", {
        id: "point-references",
        class: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm",
      })
      for (const {field, kind} of references) {
        const label = texts.fields?.[field] ?? field
        list.appendChild(element("dt", {class: "text-base-content/70"}, label))
        list.appendChild(
          element(
            "dd",
            {id: `point-reference-${field}`, class: "font-mono break-all"},
            referenceText(point[field], kind, texts),
          ),
        )
      }
      this.details.appendChild(list)
    }

    for (const {field} of fields.filter(({kind}) => kind === "formula")) {
      const id = `point-field-${field}`
      const wrapper = element("div", {class: "fieldset"})
      const label = element("label", {for: id})
      label.appendChild(element("span", {class: "label mb-1"}, texts.fields?.[field] ?? field))
      const input = element("input", {
        type: "text",
        id,
        "data-field": field,
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-describedby": `${id}-error`,
        class: "w-full input min-h-11 font-mono",
      })
      input.value = typeof point[field] === "string" ? point[field] : ""
      label.appendChild(input)
      wrapper.appendChild(label)
      wrapper.appendChild(element("p", {id: `${id}-error`, class: "text-sm text-error"}))
      this.details.appendChild(wrapper)
    }

    const offset = point.user_offset
    const moved = offset && (offset.dx !== 0 || offset.dy !== 0)
    this.details.appendChild(
      element(
        "p",
        {id: "point-offset", class: "text-sm"},
        moved
          ? fill(texts.offset, {x: centimetres(offset.dx, texts), y: centimetres(offset.dy, texts)})
          : (texts.not_moved ?? ""),
      ),
    )
    const reset = element(
      "button",
      {type: "button", id: "reset-offset", class: "btn min-h-11"},
      texts.reset_offset ?? "",
    )
    reset.disabled = !moved
    this.details.appendChild(reset)
  }

  /** Shows `text` under the formula field `field` of the shown point (null clears it). */
  setFieldError(field, text) {
    this.setError(this.details?.querySelector(`#point-field-${CSS.escape(field)}`), text)
  }

  /** The parameter rows: [{name, unit, default, input}], from the rows HEEx rendered. */
  parameterRows() {
    return [...this.aside.querySelectorAll("[data-parameter]")].map(row => ({
      name: row.dataset.parameter,
      unit: row.dataset.unit,
      default: Number(row.dataset.default),
      input: row.querySelector("input"),
    }))
  }

  /** Writes the values of `parameters` (defaults where there is none) and clears the errors. */
  renderParameters(parameters) {
    for (const row of this.parameterRows()) this.renderParameter(row, parameters)
  }

  renderParameter(row, parameters) {
    if (!row.input) return
    const value = Object.hasOwn(parameters, row.name) ? parameters[row.name] : row.default
    row.input.value = Number.isFinite(value)
      ? formatDisplay(toDisplay(value, row.unit), this.texts.decimal_separator ?? ".")
      : ""
    this.setError(row.input, null)
  }

  /** Shows `text` under the parameter `name`'s input (null clears it). */
  setParameterError(name, text) {
    const row = this.parameterRows().find(candidate => candidate.name === name)
    this.setError(row?.input, text)
  }

  /**
   * Adds the "not saved" sentence to the error of `input`, which keeps text the pattern could not
   * use when its `change` event commits: the drawing and the save have the last value that
   * worked. The next keystroke replaces the whole error.
   */
  setNotSaved(input) {
    const error = this.errorElement(input)
    const note = this.texts.not_saved ?? ""
    if (!error || !note || error.textContent.endsWith(note)) return
    error.textContent = error.textContent ? `${error.textContent} ${note}` : note
  }

  // The error paragraph of an input is `<id>-error`, without the input's `-input` suffix
  // (`point-field-dx-error`, `parameter-ease_hip-error`).
  errorElement(input) {
    return input ? document.getElementById(`${input.id.replace(/-input$/, "")}-error`) : null
  }

  setError(input, text) {
    if (!input) return
    const error = this.errorElement(input)
    if (error) error.textContent = text ?? ""
    input.classList.toggle("input-error", Boolean(text))
    if (text) input.setAttribute("aria-invalid", "true")
    else input.removeAttribute("aria-invalid")
  }
}
