// Panels: the DOM of the editor aside (#pattern-editor, docs/adr/0008-pattern-editor.md).
//
// HEEx renders the aside once (phx-update="ignore"): the undo/redo buttons, the save status, the
// alert, the point select (option values `<part>.<point>`) with an empty #point-details, and one
// row per parameter of each part. This module fills and updates it; PatternEditor decides what to
// show. All text comes from the hook's `data-texts` (ToileWeb.EditorTexts), never from here.
//
// A parameter row carries its part, name, stored default and unit only (`data-part`,
// `data-parameter`, `data-default`, `data-unit`); its input and "Default" hint render empty and
// are filled here in the display unit with the engine's units, so the conversion has one source.
// The editor passes the working parts, `{partName: {parameters}}`, to the constructor, which
// writes their overrides with renderParameters.
//
// The seam allowance panel (#seam-allowance-panel,
// docs/adr/0011-markings-and-seam-allowance-storage.md) renders with an empty project default
// input and its hint, the edge select (option values `<part>.<curve>`) and an empty
// #edge-details; renderSeamAllowanceDefault and renderEdge fill them in cm. Curve names are shown
// as text only.

import {
  DEFAULT_SEAM_ALLOWANCE,
  formatDisplay,
  pointFields,
  toDisplay,
} from "../../../engine/src/index"

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

/** A stored value as text in `unit`'s display unit with the locale's decimal separator. */
function displayText(value, unit, texts) {
  return formatDisplay(toDisplay(value, unit), texts.decimal_separator ?? ".")
}

/** A length in mm as cm text with the locale's decimal separator. */
function centimetres(mm, texts) {
  return displayText(mm, "length", texts)
}

function referenceText(value, kind, texts) {
  if (kind === "line" && Array.isArray(value)) return value.map(String).join(" – ")
  if (kind === "which") return texts.which?.[value] ?? String(value ?? "")
  return String(value ?? "")
}

export class Panels {
  /** The panels of `aside`, with the inputs showing the overrides of `parts`. */
  constructor(aside, texts, parts = {}) {
    this.aside = aside
    this.texts = texts
    this.undoButton = aside.querySelector("#undo-button")
    this.redoButton = aside.querySelector("#redo-button")
    this.status = aside.querySelector("#save-status")
    this.alert = aside.querySelector("#editor-alert")
    this.pointSelect = aside.querySelector("#point-select")
    this.details = aside.querySelector("#point-details")
    this.defaultInput = aside.querySelector("#seam-allowance-default-input")
    this.defaultHint = aside.querySelector("#seam-allowance-default-hint")
    this.edgeSelect = aside.querySelector("#edge-select")
    this.edgeDetails = aside.querySelector("#edge-details")
    // HEEx renders the rows once and never patches them (phx-update="ignore").
    this.rows = [...aside.querySelectorAll("[data-parameter]")].map(row => ({
      part: row.dataset.part,
      name: row.dataset.parameter,
      unit: row.dataset.unit,
      default: Number(row.dataset.default),
      input: row.querySelector("input"),
      hint: row.querySelector(`#${CSS.escape(row.id)}-hint`),
    }))
    this.fillHints()
    this.renderParameters(parts)
  }

  // Writes each row's default with the unit text into its "Default" hint.
  fillHints() {
    const texts = this.texts
    for (const row of this.rows) {
      if (row.hint && Number.isFinite(row.default)) {
        const unit = texts.units?.[row.unit] ?? ""
        const value = `${displayText(row.default, row.unit, texts)} ${unit}`.trim()
        row.hint.textContent = fill(texts.default, {value})
      }
    }
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
   * Fills #point-details for the raw point `point` of part `part` (or empties it for none): its
   * name, what its operation does, its reference fields read-only, an input per formula field,
   * and its offset with the button that removes it. The formula inputs carry `data-field`.
   */
  renderPoint(point, part = null) {
    if (this.pointSelect) this.pointSelect.value = point && part ? `${part}.${point.name}` : ""
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

  /** A length in mm as cm text with its unit ("1,5 cm"). */
  lengthText(mm) {
    return `${centimetres(mm, this.texts)} ${this.texts.units?.length ?? ""}`.trim()
  }

  /**
   * Writes the project default of `allowances` into its input in cm, with the hint for an empty
   * field (DEFAULT_SEAM_ALLOWANCE), and clears its error.
   */
  renderSeamAllowanceDefault(allowances) {
    if (this.defaultHint) {
      this.defaultHint.textContent = fill(this.texts.seam_allowance?.default_hint, {
        value: this.lengthText(DEFAULT_SEAM_ALLOWANCE),
      })
    }
    if (!this.defaultInput) return
    this.defaultInput.value = centimetres(allowances.default, this.texts)
    this.setError(this.defaultInput, null)
  }

  /**
   * Fills #edge-details for the selected edge `edge`, `{part, curve}` (or empties it for null):
   * the curve name, an input with the edge's allowance `allowance` (`{value}` in mm) in cm, and
   * the hint for an empty field, `fallback` (`{fold, value}`: the fold rule's 0 or the project
   * default). The same edge again keeps its elements and only updates them, so the focus stays.
   */
  renderEdge(edge, allowance = null, fallback = null) {
    const key = edge ? `${edge.part}.${edge.curve}` : ""
    if (this.edgeSelect) this.edgeSelect.value = key
    if (!this.edgeDetails) return
    if (!edge) {
      this.edgeDetails.replaceChildren()
      delete this.edgeDetails.dataset.edge
      return
    }
    if (this.edgeDetails.dataset.edge !== key) this.buildEdge(edge.curve)
    this.edgeDetails.dataset.edge = key

    const texts = this.texts.seam_allowance ?? {}
    const input = this.edgeDetails.querySelector(`#edge-allowance-input`)
    const hint = this.edgeDetails.querySelector(`#edge-allowance-hint`)
    if (hint) {
      const template = fallback?.fold ? texts.fold_hint : texts.default_hint
      hint.textContent = fill(template, {value: this.lengthText(fallback?.value ?? 0)})
    }
    if (input) {
      input.value = centimetres(allowance?.value ?? 0, this.texts)
      this.setError(input, null)
    }
  }

  buildEdge(curve) {
    const id = "edge-allowance-input"
    const wrapper = element("div", {class: "fieldset"})
    const label = element("label", {for: id})
    label.appendChild(
      element("span", {class: "label mb-1"}, this.texts.seam_allowance?.edge_label ?? ""),
    )
    label.appendChild(
      element("input", {
        type: "text",
        id,
        inputmode: "decimal",
        autocomplete: "off",
        "aria-describedby": "edge-allowance-hint edge-allowance-error",
        class: "w-full input min-h-11",
      }),
    )
    wrapper.appendChild(label)
    this.edgeDetails.replaceChildren(
      element("p", {id: "edge-name", class: "font-mono font-semibold break-all"}, curve),
      wrapper,
      element("p", {id: "edge-allowance-hint", class: "-mt-1 text-sm text-base-content/70"}),
      element("p", {id: "edge-allowance-error", class: "text-sm text-error"}),
    )
  }

  /** Shows `text` under the formula field `field` of the shown point (null clears it). */
  setFieldError(field, text) {
    this.setError(this.details?.querySelector(`#point-field-${CSS.escape(field)}`), text)
  }

  /** The parameter rows: [{part, name, unit, default, input, hint}], read once on creation. */
  parameterRows() {
    return this.rows
  }

  /**
   * Writes the overrides of `parts`, `{partName: {parameters}}` (defaults where there is none),
   * and clears the errors.
   */
  renderParameters(parts) {
    for (const row of this.parameterRows()) this.renderParameter(row, parts)
  }

  renderParameter(row, parts) {
    if (!row.input) return
    const parameters = (Object.hasOwn(parts, row.part) && parts[row.part]?.parameters) || {}
    const value = Object.hasOwn(parameters, row.name) ? parameters[row.name] : row.default
    row.input.value = Number.isFinite(value) ? displayText(value, row.unit, this.texts) : ""
    this.setError(row.input, null)
  }

  /** Shows `text` under the input of the parameter row `row` (null clears it). */
  setParameterError(row, text) {
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
  // (`point-field-dx-error`, `parameter-straight_skirt-ease_hip-error`).
  errorElement(input) {
    return input ? document.getElementById(`${input.id.replace(/-input$/, "")}-error`) : null
  }

  /** Shows `text` under `input` (its `<id>-error` paragraph; null clears it) and marks it. */
  setError(input, text) {
    if (!input) return
    const error = this.errorElement(input)
    if (error) error.textContent = text ?? ""
    input.classList.toggle("input-error", Boolean(text))
    if (text) input.setAttribute("aria-invalid", "true")
    else input.removeAttribute("aria-invalid")
  }
}
