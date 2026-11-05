// PatternView: draws a pattern project to scale in SVG, computed by the engine in the browser.
//
// Data attributes (set by ToileWeb.PatternLive.Show):
//   data-key           the measurement profile id; a change means new input
//   data-parts         the project's parts, [{"name", "definition"}], main part first (JSON,
//                      untrusted: the engine validates it). The editor reads them on mount and
//                      only takes parts it does not have yet from a later value.
//   data-input         {"measurements": {...}, "parameters": {partName: {...}}} in millimetres (JSON)
//   data-piece-labels  {partName: {pieceName: label}} for the pieces of every part (JSON)
//   data-piece-cuts    {partName: {pieceName: cutting instruction}} for the pieces that have one
//                      (JSON; a project created before ticket 0015 has none)
//   data-seam-allowances  the stored seam allowances, {"default": mm, "edges": {partName:
//                      {curveName: mm}}} (JSON, read tolerantly with the engine's
//                      readSeamAllowances). Read on mount only: then the editor owns them.
//   data-notes         the id of the list under the drawing for notes about the cutting lines
//   data-error-text    shown instead of a drawing when the pattern cannot be computed
//   data-editor        the id of the editor aside (optional); with it the pattern is editable
//   data-texts         the editor's UI texts (JSON, ToileWeb.EditorTexts)
//   data-max-save-bytes  the most a save's definition and parameters may encode to (JSON bytes)
//   data-max-definition-bytes  the most a save's definition alone may encode to (JSON bytes)
//   data-pdf-paper     the id of the paper select ("a4" or "letter"; anything else counts as A4)
//   data-pdf-status    the id of the PDF status line (plain text)
//   data-pdf-title     the project name, the PDF's title
//   data-pdf-filename  the download name of the PDF
// The element's aria-label also names the SVG.
//
// All parts are evaluated together (the engine's compileProject), so a part that imports values
// from another, like a sleeve from the bodice armhole, is always computed from the same input. If
// any part fails, nothing is drawn. The layout is the engine's layoutProject, the same one the PDF
// uses, and is done when the drawing is built: it moves the pieces of each part apart by their
// boxes with the cutting lines (taken from this hook's cache), so they never overlap whatever the
// seam allowances, and places the parts side by side. Each part is drawn in a <g data-part>
// translated by its offset, each piece in it in a <g data-piece> translated by its own. Every
// mapping between the drawing and a part's coordinates uses the same offsets: pieceOffset(part,
// piece) for an edge (tap and highlight), pointOffset(part, point) for a point (handles, hover,
// drag), where a point goes with the piece the engine's pointPieces gives it. The layout, and
// which piece each point goes with, stay while the pattern is edited, so a dragged point does not
// slip away from the pointer; they are redone on the next build and by relayout(), which the
// editor calls when the seam allowances it commits change.
//
// Each piece group holds, in drawing order (docs/adr/0011-markings-and-seam-allowance-storage.md):
// the cutting line (solid), the seam line (the outline, dashed), the fold edges (dash-dot, primary
// colour), the grainline, the notches as short marks into the piece from the seam line and from
// the cutting line, and the label. The cutting line is the engine's cuttingLine for the piece's
// allowances (pieceSeamAllowances: the project default, 0 on a fold edge, the user's value per
// edge). It is computed on every update, also each frame of a drag, and cached per piece (its
// latest line, keyed by its path data, curve names and allowances), so unchanged pieces cost
// nothing (ADR 0011 decision 8). The layout and the fit cover the cutting lines. A piece without a
// cutting line, or one drawn with approximations, gets a sentence in the notes list (data-notes),
// always as plain text. The dashes of the seam and fold lines are in mm, so they keep their real
// length at every zoom; their widths are set per view in pixels, like the other strokes (which are
// non-scaling).
//
// With an editor (assets/js/editor/pattern_editor.js, docs/adr/0008-pattern-editor.md) the
// editor owns the working definitions and parameters of all parts: compute() asks it for the
// result, it calls update() while points are dragged and edited, and it draws the point handles
// into one layer per part over the drawing, each point at its pointOffset. A press on a point is
// the editor's (drag); a press elsewhere pans as before, and a second pointer during a drag
// cancels the drag and pinches. A press that pans but ends within TAP_DISTANCE_PX of where it
// started is a tap: the editor selects the edge under it (editor.tap), and the hook highlights
// the selected edge in a path of each piece group.
//
// Drawing has three parts: compute() evaluates the project for the current input, draw() builds
// the SVG elements once per input (and fits the view to them), and update() moves the existing
// elements to a new result without touching the view. updated() redraws only when data-key,
// data-parts or data-input changed.
//
// Each piece's label (its name, and on a second line its cutting instruction) is centred inside it
// where its text box is farthest from the outline, darts and grainline (the engine's placeLabel,
// which takes the two lines as one text split on "\n"), and shrunk when the piece is too narrow
// for it. A placement costs several milliseconds, so placements are cached by label text, outline
// and grainline, and update(result, {labels: "keep"}) leaves the labels where they are. The
// grainline arrowheads are drawn at GRAINLINE_ARROW_SIZE, the size placeLabel keeps clear of.
//
// The SVG user unit is 1 mm. Zoom and pan only change the viewBox (and the grid lines that cover
// what is visible). Events on the element:
//   toile:fit                      resets the view to the whole pattern
//   toile:zoom {detail: {factor}}  zooms around the centre (factor < 1 zooms in)
//   toile:pdf                      downloads the PDF of the working state (downloadPdf)
// Wheel zooms around the pointer, two pointers pinch-zoom, one pointer pans, and with focus the
// arrow keys pan, + and - zoom and 0 fits.
//
// The PDF is the engine's (patternPdf, docs/adr/0012-pdf-printing.md): the hook hands it the
// result it draws and the current seam allowances, so the PDF holds the working state, unsaved
// edits included, with the same labels as the drawing, and offers the bytes as a download. The
// PDF lays that state out afresh with layoutProject, while the view keeps its last layout during
// point edits (see above), so after a drag the pieces may sit apart differently in the PDF than on
// the page; they never overlap in either. The page texts and the error texts are the "pdf" group
// of data-texts.

import {
  GRAINLINE_ARROW_SIZE,
  LABEL_LINE_HEIGHT,
  compileProject,
  curvePathData,
  cuttingLine,
  cuttingLineNotches,
  cuttingLinePathData,
  layoutProject,
  patternPdf,
  piecePathData,
  pieceSeamAllowances,
  placeLabel,
  pointPieces,
  readPaper,
  readSeamAllowances,
} from "../../../engine/src/index"
import {PatternEditor} from "../editor/pattern_editor"
import {isObject, parseJSON} from "../json"
import {fill} from "../text"
import {center, fit, gridPathData, panBy, toAttribute, visibleArea, zoomAt} from "./viewport"

const SVG_NS = "http://www.w3.org/2000/svg"
const FIT_MARGIN = 20
const LABEL_SIZE = 14
// Grid lines closer than this many pixels are not drawn (they would only grey the view).
const MIN_GRID_SPACING_PX = 4
const KEY_PAN_FRACTION = 0.1
const KEY_ZOOM_FACTOR = 0.8
// Label placements kept before the cache starts over.
const LABEL_CACHE_SIZE = 200
// A panning press that moves less than this many pixels is a tap (it selects an edge).
const TAP_DISTANCE_PX = 3
// How long a downloaded file's Blob URL stays valid after the click.
const BLOB_URL_LIFETIME_MS = 10_000
// Stroke widths in pixels. The seam and fold lines are dashed in mm, so their width is set per
// view (render).
const CUTTING_WIDTH_PX = 2
const SEAM_WIDTH_PX = 1.25
const FOLD_WIDTH_PX = 2
const SELECTED_EDGE_WIDTH_PX = 8
// Dash patterns in mm.
const SEAM_DASH = "4 2"
const FOLD_DASH = "10 2 2 2"

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

/** `map[part][piece]` when it is a string (own keys only), else null. */
function textOf(map, part, piece) {
  const texts = isObject(map) && Object.hasOwn(map, part) ? map[part] : null
  const text = isObject(texts) && Object.hasOwn(texts, piece) ? texts[piece] : null
  return typeof text === "string" && text !== "" ? text : null
}

/** The label text of piece `piece` of part `part`: its name, and its cutting instruction on a
 * second line when it has one. */
function labelText(labels, cuts, part, piece) {
  const name = textOf(labels, part, piece) ?? piece
  return [name, textOf(cuts, part, piece)].filter(Boolean).join("\n")
}

/** The short lines of `notches` (the engine's ComputedNotch list). */
function notchMarks(notches) {
  return notches.flatMap(notch =>
    notch.marks.map(mark =>
      svgElement("line", {
        x1: mark.from.x,
        y1: mark.from.y,
        x2: mark.to.x,
        y2: mark.to.y,
        stroke: "currentColor",
        "stroke-width": 1.5,
        "stroke-linecap": "round",
        "vector-effect": "non-scaling-stroke",
      }),
    ),
  )
}

/** The path data of the outline curves of `piece` named `name`. */
function curvesPathData(piece, name) {
  return piece.outline
    .filter(curve => curve.name === name)
    .map(curve => curvePathData(curve))
    .join(" ")
}

const PatternView = {
  mounted() {
    this.pointers = new Map()
    this.frame = null

    this.onWheel = event => this.wheel(event)
    this.onPointerDown = event => this.pointerDown(event)
    this.onPointerMove = event => this.pointerMove(event)
    this.onPointerUp = event => this.pointerUp(event)
    this.onPointerCancel = event => this.pointerCancel(event)
    this.onKeyDown = event => this.keyDown(event)
    this.onFit = () => this.setView(this.fitted)
    this.onZoom = event => this.zoomBy(Number(event.detail?.factor))
    this.onPdf = () => this.downloadPdf()

    this.el.addEventListener("wheel", this.onWheel, {passive: false})
    this.el.addEventListener("pointerdown", this.onPointerDown)
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerup", this.onPointerUp)
    this.el.addEventListener("pointercancel", this.onPointerCancel)
    this.el.addEventListener("lostpointercapture", this.onPointerCancel)
    this.el.addEventListener("keydown", this.onKeyDown)
    this.el.addEventListener("toile:fit", this.onFit)
    this.el.addEventListener("toile:zoom", this.onZoom)
    this.el.addEventListener("toile:pdf", this.onPdf)

    // The grid covers what is visible, which depends on the element's size.
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender())
    this.resizeObserver.observe(this.el)

    this.labelCache = new Map()
    this.cuttingCache = new Map()
    this.drawn = this.source()
    this.pieceLabels = parseJSON(this.el.dataset.pieceLabels, {})
    this.pieceCuts = parseJSON(this.el.dataset.pieceCuts, {})
    this.storedAllowances = readSeamAllowances(parseJSON(this.el.dataset.seamAllowances, null))
    const texts = parseJSON(this.el.dataset.texts, {})
    this.texts = isObject(texts) ? texts : {}
    this.notesShown = null
    // A panning press that may still be a tap: {id, x, y} in client pixels.
    this.tap = null
    this.parts = parseJSON(this.el.dataset.parts, null)
    // The pointer that drags a point, and where it last was (client pixels).
    this.dragPointer = null
    this.dragAt = null
    const input = parseJSON(this.el.dataset.input, null)
    this.editor = PatternEditor.create(this, this.parts, input)
    this.draw(this.compute(input))
  },

  // phx-update="ignore" still patches data attributes. New input (another profile) or new parts
  // (a part added) redraw. The editor keeps its working definitions and only takes new parts,
  // with their aside (data-editor names a new one when the parts change).
  updated() {
    const source = this.source()
    const drawn = this.drawn
    this.drawn = source
    const input = parseJSON(source.input, null)
    if (source.parts !== drawn.parts) {
      this.parts = parseJSON(source.parts, null)
      this.compiled = null
      this.editor?.addParts(this.parts, input)
    }
    // After addParts, so the new aside shows the new parts' values.
    if (source.editor !== drawn.editor && this.editor) {
      const aside = document.getElementById(source.editor)
      if (aside) this.editor.setAside(aside)
    }
    if (source.key === drawn.key && source.parts === drawn.parts && source.input === drawn.input) {
      return
    }
    this.pieceLabels = parseJSON(this.el.dataset.pieceLabels, {})
    this.pieceCuts = parseJSON(this.el.dataset.pieceCuts, {})
    this.draw(this.compute(input))
  },

  source() {
    const {key, parts, input, editor} = this.el.dataset
    return {key, parts, input, editor}
  },

  // Saves made while the connection was down are sent again.
  reconnected() {
    this.editor?.resendIfUnsaved()
  },

  // The editor sends the commits that are not stored yet once more before it goes (e.g. when
  // another profile lacks measurements and the drawing makes way for a message).
  destroyed() {
    this.editor?.destroy()
    this.renderNotes([])
    this.resizeObserver?.disconnect()
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  },

  // The project evaluated for `input`, or null without input. Compiles once per set of parts.
  // The editor evaluates its working state instead, with the measurements of `input`.
  compute(input) {
    if (this.editor) return this.editor.load(input)
    if (!input) return null
    this.compiled ??= compileProject(this.parts)
    return this.compiled.evaluate(input)
  },

  // Builds the drawing of `result` (a project result), lays the parts out and fits the view to
  // them (with fit: false it keeps the view it has, if any), or shows the error text when the
  // pattern cannot be drawn.
  draw(result, {fit: refit = true} = {}) {
    const view = refit ? null : this.viewBox
    this.editor?.cancelDrag()
    this.dragPointer = null
    this.pointers.clear()
    this.tap = null
    this.svg = null
    this.shown = null
    this.el.replaceChildren()

    this.layoutAllowances = this.allowances()
    // cuttingLineOf reads the same allowances (this.allowances()) and caches the lines.
    const layout = layoutProject(
      result?.ok ? result.parts : {},
      this.layoutAllowances,
      (part, piece) => this.cuttingLineOf(part, piece),
    )
    if (!result?.ok || !layout.bounds) {
      if (result && !result.ok) console.warn("Pattern errors", this.errorsOf(result))
      this.renderNotes([])
      this.showError()
      return
    }

    // Offsets within a part (for the piece groups) and in the drawing (for every mapping).
    this.localOffsets = new Map()
    this.pieceOffsets = new Map()
    this.pointOwners = new Map()
    this.partOffsets = new Map()
    for (const {name, offset, pieces} of layout.parts) {
      this.partOffsets.set(name, offset)
      this.localOffsets.set(name, new Map(pieces.map(({piece, local}) => [piece.name, local])))
      this.pieceOffsets.set(name, new Map(pieces.map(({piece, offset}) => [piece.name, offset])))
      this.pointOwners.set(name, pointPieces(result.parts[name]))
    }
    this.fitted = fit(layout.bounds, FIT_MARGIN)
    this.svg = this.buildSvg(result)
    this.el.appendChild(this.svg)
    this.update(result)
    this.setView(view ?? this.fitted)
  },

  // Draws `result` again with a new layout in the same view: the editor calls it when the
  // committed seam allowances change, so the gaps between the parts follow the cutting lines.
  // Without such a change it only updates the drawing. A press in progress (the press on the
  // drawing that took the focus from an allowance field commits it) keeps its drag or pan: the
  // new layout waits until the last pointer is up (relayoutIfStale).
  relayout(result) {
    if (!result?.ok) return
    const pressed = this.pointers.size > 0 || this.dragPointer !== null
    if (this.svg && (this.allowances() === this.layoutAllowances || pressed)) this.update(result)
    else this.draw(result, {fit: !this.svg})
  },

  // Lays the drawn result out again if the allowances changed since the layout and no pointer is
  // down.
  relayoutIfStale() {
    if (this.pointers.size > 0 || this.dragPointer !== null) return
    if (this.svg && this.shown && this.allowances() !== this.layoutAllowances) {
      this.draw(this.shown, {fit: false})
    }
  },

  // The project's seam allowances: the editor's working ones, else the stored ones.
  allowances() {
    return this.editor?.seamAllowances() ?? this.storedAllowances
  },

  // The cutting line (the engine's CuttingLineResult) of `piece` of part `part` for the current
  // allowances. The cache holds the latest line of each piece (by part and piece name), with its
  // key: the piece's path data, its outline curve names (the allowances are keyed by them) and
  // its effective allowances. So it stays one entry per piece however long a drag runs.
  cuttingLineOf(part, piece, pathData = piecePathData(piece)) {
    const {default: fallback, edges} = this.allowances()
    const own = Object.hasOwn(edges, part) ? edges[part] : undefined
    const allowances = pieceSeamAllowances(piece, fallback, own)
    const names = piece.outline.map(curve => curve.name)
    const key = `${pathData}\n${JSON.stringify([names, allowances])}`
    const slot = JSON.stringify([part, piece.name])
    const cached = this.cuttingCache.get(slot)
    if (cached?.key === key) return cached.line
    const line = cuttingLine(piece, allowances)
    this.cuttingCache.set(slot, {key, line})
    return line
  },

  // Moves the drawn elements to `result` (a result of the same parts) without changing the view
  // or the layout. With labels: "keep" the labels stay where they are, e.g. while a point is
  // dragged; "place" places them again. A result with other parts or pieces than the drawing is
  // drawn anew in the same view, and a result when nothing is drawn yet is drawn and fitted. A
  // result with errors changes nothing: the last good drawing stays.
  update(result, {labels = "place"} = {}) {
    if (!result?.ok) return
    if (!this.svg || !this.drawsPieces(result)) {
      this.draw(result, {fit: !this.svg})
      return
    }
    this.shown = result
    const notes = []
    for (const [part, partResult] of Object.entries(result.parts)) {
      const pieces = this.pieceElements.get(part)
      for (const piece of Object.values(partResult.pieces)) {
        const elements = pieces.get(piece.name)
        const pathData = piecePathData(piece)
        const line = this.cuttingLineOf(part, piece, pathData)
        elements.cutting.setAttribute("d", line.ok ? cuttingLinePathData(line.points) : "")
        elements.outline.setAttribute("d", pathData)
        elements.folds.setAttribute(
          "d",
          piece.folds.map(name => curvesPathData(piece, name)).join(" "),
        )
        const {from, to} = piece.grainline
        elements.grainline.setAttribute("x1", from.x)
        elements.grainline.setAttribute("y1", from.y)
        elements.grainline.setAttribute("x2", to.x)
        elements.grainline.setAttribute("y2", to.y)
        elements.notches.replaceChildren(...notchMarks(piece.notches))
        elements.cutNotches.replaceChildren(
          ...(line.ok ? notchMarks(cuttingLineNotches(piece.notches, line.points)) : []),
        )
        if (labels === "place") this.placeLabelOf(piece, pathData, elements)
        notes.push(...this.cuttingNotes(line, elements.name))
      }
    }
    this.highlightEdge()
    this.renderNotes(notes)
    this.editor?.moveHandles(result)
  },

  // The sentences about the cutting line `line` of the piece labelled `name`: that it could not
  // be drawn, or one per kind of approximation it was drawn with (each kind once).
  cuttingNotes(line, name) {
    const texts = isObject(this.texts.cutting_line) ? this.texts.cutting_line : {}
    const kinds = line.ok
      ? [...new Set((line.approximations ?? []).map(({kind}) => kind))]
      : ["failed"]
    return kinds
      .filter(kind => typeof texts[kind] === "string" && Object.hasOwn(texts, kind))
      .map(kind => fill(texts[kind], {piece: name}))
  },

  // Shows `notes` in the notes list (data-notes) as plain text, one item each; only touches the
  // list when the notes change, so a drag does not make a screen reader repeat them.
  renderNotes(notes) {
    const shown = notes.join("\n")
    if (shown === this.notesShown) return
    this.notesShown = shown
    const list = this.el.dataset.notes ? document.getElementById(this.el.dataset.notes) : null
    if (!list) return
    list.replaceChildren(
      ...notes.map(text => {
        const item = document.createElement("li")
        item.textContent = text
        return item
      }),
    )
  },

  // Highlights the editor's selected edge (every outline curve of that name in its part, each in
  // its piece's group) in the drawn result, or no edge.
  highlightEdge() {
    if (!this.edgeLayers || !this.shown) return
    const edge = this.editor?.selectedEdge ?? null
    for (const [part, paths] of this.edgeLayers) {
      const pieces = edge?.part === part ? this.shown.parts[part]?.pieces : null
      for (const [name, path] of paths) {
        const piece = pieces && Object.hasOwn(pieces, name) ? pieces[name] : null
        path.setAttribute("d", piece ? curvesPathData(piece, edge.curve) : "")
      }
    }
  },

  // Whether the drawing has exactly the parts and pieces of `result`.
  drawsPieces(result) {
    const parts = Object.entries(result.parts)
    if (parts.length !== this.pieceElements.size) return false
    return parts.every(([part, partResult]) => {
      const drawn = this.pieceElements.get(part)
      const names = Object.keys(partResult.pieces)
      return drawn && names.length === drawn.size && names.every(name => drawn.has(name))
    })
  },

  // Inside the piece, clear of the outline, darts and grainline (the engine's placeLabel),
  // centred on the returned point. A piece without area falls back to the grainline's midpoint,
  // start-anchored half a label height to its right so the text sits beside the line instead of
  // straddling it.
  placeLabelOf(piece, pathData, {label, labelText: text}) {
    const {from, to} = piece.grainline
    const key = `${text}\n${pathData}\n${from.x} ${from.y} ${to.x} ${to.y}`
    let place = this.labelCache.get(key)
    if (!place) {
      const placed = placeLabel(piece, text, LABEL_SIZE)
      place = placed
        ? {...placed, anchor: "middle"}
        : {
            x: (from.x + to.x) / 2 + LABEL_SIZE / 2,
            y: (from.y + to.y) / 2,
            size: LABEL_SIZE,
            anchor: "start",
          }
      if (this.labelCache.size >= LABEL_CACHE_SIZE) this.labelCache.clear()
      this.labelCache.set(key, place)
    }
    label.setAttribute("x", place.x)
    label.setAttribute("y", place.y)
    label.setAttribute("font-size", place.size)
    label.setAttribute("text-anchor", place.anchor)
    // Each line starts at the anchor again.
    for (const line of label.children) line.setAttribute("x", place.x)
  },

  // Downloads the PDF of the drawn result (the working state) on the chosen paper, or says in
  // the status line (data-pdf-status, plain text) why there is none.
  downloadPdf() {
    const status = this.el.dataset.pdfStatus
      ? document.getElementById(this.el.dataset.pdfStatus)
      : null
    const texts = isObject(this.texts.pdf) ? this.texts.pdf : {}
    const text = key => (Object.hasOwn(texts, key) && typeof texts[key] === "string" ? texts[key] : "")
    const say = message => {
      if (status) status.textContent = message
    }
    say("")
    try {
      const result = this.shown
      if (!result?.ok) {
        say(text("failed"))
        return
      }
      const select = this.el.dataset.pdfPaper
        ? document.getElementById(this.el.dataset.pdfPaper)
        : null
      // As the drawing labels the pieces (pieceGroup). fromEntries defines own keys, whatever
      // the part and piece names.
      const labels = Object.fromEntries(
        Object.entries(result.parts).map(([part, partResult]) => [
          part,
          Object.fromEntries(
            Object.values(partResult.pieces).map(piece => [
              piece.name,
              labelText(this.pieceLabels, this.pieceCuts, part, piece.name),
            ]),
          ),
        ]),
      )
      const pdf = patternPdf({
        parts: result.parts,
        allowances: this.allowances(),
        labels,
        paper: readPaper(select?.value),
        title: this.el.dataset.pdfTitle ?? "",
        texts: {
          testSquare: text("test_square"),
          scaleCheck: text("scale_check"),
          assembly: text("assembly"),
          overview: text("overview"),
        },
      })
      if (!pdf.ok) {
        say(text(pdf.kind === "too_many_pages" ? "too_large" : "failed"))
        return
      }
      this.saveFile(new Blob([pdf.bytes], {type: "application/pdf"}))
    } catch (error) {
      console.warn("PDF export failed", error)
      say(text("failed"))
    }
  },

  // Offers `blob` as a download named data-pdf-filename.
  saveFile(blob) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = this.el.dataset.pdfFilename || "pattern.pdf"
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Some browsers cancel a download whose URL is revoked straight after the click.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS)
  },

  // The project's own errors and every part's, each tagged with its part name.
  errorsOf(result) {
    const partErrors = Object.entries(result.parts).flatMap(([part, partResult]) =>
      (partResult.errors ?? []).map(error => ({part, ...error})),
    )
    return [...result.errors, ...partErrors]
  },

  showError() {
    const message = document.createElement("p")
    message.setAttribute("role", "alert")
    message.className = "p-4 text-error"
    message.textContent = this.el.dataset.errorText ?? ""
    this.el.appendChild(message)
  },

  // The SVG with one group per part, translated by its layout offset, holding one group per
  // piece (see pieceGroup) translated by the piece's offset within the part, with an editor each
  // with a selected-edge path; then, with an editor, one handle layer per part, untranslated (the
  // handles add each point's offset). Without geometry: update() sets that.
  buildSvg(result) {
    const id = this.el.id
    const svg = svgElement("svg", {
      class: "block size-full text-base-content",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": this.el.getAttribute("aria-label") ?? "",
    })

    const defs = svgElement("defs")
    const arrow = svgElement("marker", {
      id: `${id}-arrow`,
      viewBox: "0 0 10 10",
      refX: 10,
      refY: 5,
      markerUnits: "userSpaceOnUse",
      markerWidth: GRAINLINE_ARROW_SIZE,
      markerHeight: GRAINLINE_ARROW_SIZE,
      orient: "auto-start-reverse",
    })
    arrow.appendChild(svgElement("path", {d: "M0 0L10 5L0 10z", fill: "currentColor"}))
    defs.appendChild(arrow)
    svg.appendChild(defs)

    const gridStyle = {fill: "none", stroke: "currentColor", "vector-effect": "non-scaling-stroke"}
    this.minorGrid = svgElement("path", {...gridStyle, "stroke-opacity": 0.08, "stroke-width": 1})
    this.majorGrid = svgElement("path", {...gridStyle, "stroke-opacity": 0.25, "stroke-width": 1})
    svg.appendChild(this.minorGrid)
    svg.appendChild(this.majorGrid)

    this.pieceElements = new Map()
    this.scaledStrokes = []
    this.edgeLayers = this.editor ? new Map() : null
    const handleLayers = new Map()
    for (const [part, partResult] of Object.entries(result.parts)) {
      const offset = this.partOffsets.get(part)
      const partGroup = svgElement("g", {
        "data-part": part,
        transform: `translate(${offset.dx} ${offset.dy})`,
      })
      const pieces = new Map()
      const edgePaths = new Map()
      for (const piece of Object.values(partResult.pieces)) {
        const name = textOf(this.pieceLabels, part, piece.name) ?? piece.name
        const elements = this.pieceGroup(piece.name, name, textOf(this.pieceCuts, part, piece.name))
        const local = this.localOffsets.get(part)?.get(piece.name) ?? {dx: 0, dy: 0}
        elements.group.setAttribute("transform", `translate(${local.dx} ${local.dy})`)
        if (this.editor) {
          const selectedEdge = svgElement("path", {
            "data-selected-edge": part,
            class: "text-primary",
            fill: "none",
            stroke: "currentColor",
            "stroke-opacity": 0.4,
            "stroke-width": SELECTED_EDGE_WIDTH_PX,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "vector-effect": "non-scaling-stroke",
            "pointer-events": "none",
          })
          elements.group.appendChild(selectedEdge)
          edgePaths.set(piece.name, selectedEdge)
        }
        partGroup.appendChild(elements.group)
        pieces.set(piece.name, elements)
      }
      this.pieceElements.set(part, pieces)
      this.edgeLayers?.set(part, edgePaths)
      svg.appendChild(partGroup)
    }
    // Over every part, so a part's pieces never cover another part's handles.
    if (this.editor) {
      for (const part of Object.keys(result.parts)) {
        const layer = svgElement("g", {"data-handles": part, "pointer-events": "none"})
        svg.appendChild(layer)
        handleLayers.set(part, layer)
      }
    }

    this.editor?.drawHandles(handleLayers, result)
    return svg
  },

  // The elements of one piece, without geometry: the cutting line, the seam line (the outline),
  // the fold lines, the grainline, the notch marks on the seam line and on the cutting line, and
  // the label: `name` and, on a second line, the cutting instruction `cut` (null for none).
  pieceGroup(pieceName, name, cut) {
    const id = this.el.id
    const group = svgElement("g", {"data-piece": pieceName})
    const cutting = svgElement("path", {
      "data-line": "cutting",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": CUTTING_WIDTH_PX,
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
    })
    // Dashed in mm: the width follows the view (render), so no non-scaling stroke here.
    const outline = svgElement("path", {
      "data-line": "seam",
      fill: "none",
      stroke: "currentColor",
      "stroke-dasharray": SEAM_DASH,
      "stroke-linejoin": "round",
    })
    const folds = svgElement("path", {
      "data-line": "fold",
      class: "text-primary",
      fill: "none",
      stroke: "currentColor",
      "stroke-dasharray": FOLD_DASH,
    })
    this.scaledStrokes.push(
      {element: outline, px: SEAM_WIDTH_PX},
      {element: folds, px: FOLD_WIDTH_PX},
    )
    // Until the next render, at the scale of the last view (a relayout keeps the view).
    const scale = this.lastScale ?? 1
    outline.setAttribute("stroke-width", SEAM_WIDTH_PX / scale)
    folds.setAttribute("stroke-width", FOLD_WIDTH_PX / scale)
    const grainline = svgElement("line", {
      stroke: "currentColor",
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
      "marker-start": `url(#${id}-arrow)`,
      "marker-end": `url(#${id}-arrow)`,
    })
    const notches = svgElement("g")
    const cutNotches = svgElement("g", {"data-notches": "cutting"})
    const label = svgElement("text", {
      fill: "currentColor",
      "dominant-baseline": "middle",
    })
    // One tspan per line, the block centred on the label's y.
    const lines = [name, cut].filter(Boolean)
    label.append(
      ...lines.map((line, i) => {
        const dy = i === 0 ? (-(lines.length - 1) / 2) * LABEL_LINE_HEIGHT : LABEL_LINE_HEIGHT
        const tspan = svgElement("tspan", {dy: `${dy}em`, "dominant-baseline": "middle"})
        tspan.textContent = line
        return tspan
      }),
    )
    group.append(cutting, outline, folds, grainline, notches, cutNotches, label)
    return {
      group,
      cutting,
      outline,
      folds,
      grainline,
      notches,
      cutNotches,
      label,
      name,
      labelText: lines.join("\n"),
    }
  },

  // Where piece `piece` of part `part` is drawn: the offset its coordinates are moved by in the
  // drawing (its part's and its own).
  pieceOffset(part, piece) {
    return this.pieceOffsets?.get(part)?.get(piece) ?? this.partOffsets?.get(part) ?? {dx: 0, dy: 0}
  },

  // Where point `name` of part `part` is drawn: the offset of the piece it goes with (the engine's
  // pointPieces at the layout), or its part's for a point that goes with none.
  pointOffset(part, name) {
    const owner = this.pointOwners?.get(part)?.get(name)
    return owner === undefined
      ? (this.partOffsets?.get(part) ?? {dx: 0, dy: 0})
      : this.pieceOffset(part, owner)
  },

  setView(viewBox) {
    if (!this.svg || !viewBox) return
    this.viewBox = viewBox
    this.scheduleRender()
  },

  // Batches view changes from pointer and wheel events into one update per frame.
  scheduleRender() {
    if (this.frame !== null || !this.svg) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.render()
    })
  },

  render() {
    if (!this.svg) return
    this.svg.setAttribute("viewBox", toAttribute(this.viewBox))
    const {width, height} = this.svg.getBoundingClientRect()
    const {area, scale} = visibleArea(this.viewBox, width, height)
    this.minorGrid.setAttribute("d", this.gridAt(area, scale, 10))
    this.majorGrid.setAttribute("d", this.gridAt(area, scale, 100))
    if (scale > 0) {
      this.lastScale = scale
      for (const {element, px} of this.scaledStrokes) {
        element.setAttribute("stroke-width", px / scale)
      }
    }
    this.editor?.scaleHandles(scale)
  },

  gridAt(area, scale, step) {
    return step * scale >= MIN_GRID_SPACING_PX ? gridPathData(area, step) : ""
  },

  // A screen position (client pixels) in user units of the current view. Computed from
  // this.viewBox rather than getScreenCTM(), which lags behind until the next frame renders.
  toUser(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect()
    const {scale} = visibleArea(this.viewBox, rect.width, rect.height)
    const c = center(this.viewBox)
    if (!scale) return c
    return {
      x: c.x + (clientX - (rect.left + rect.width / 2)) / scale,
      y: c.y + (clientY - (rect.top + rect.height / 2)) / scale,
    }
  },

  // Pixels per user unit of the current view.
  pixelScale() {
    const {width, height} = this.svg.getBoundingClientRect()
    return visibleArea(this.viewBox, width, height).scale || 1
  },

  zoomBy(factor) {
    if (!this.svg) return
    this.setView(zoomAt(this.viewBox, center(this.viewBox), factor))
  },

  wheel(event) {
    if (!this.svg) return
    event.preventDefault()
    // Line and page deltas (Firefox) to pixels; trackpad pinches arrive as wheel + ctrlKey.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.el.clientHeight : 1
    const speed = event.ctrlKey ? 0.01 : 0.001
    const factor = Math.exp(event.deltaY * unit * speed)
    this.setView(zoomAt(this.viewBox, this.toUser(event.clientX, event.clientY), factor))
  },

  pointerDown(event) {
    if (!this.svg || (event.pointerType === "mouse" && event.button !== 0)) return
    const at = {x: event.clientX, y: event.clientY}
    if (this.dragPointer !== null) {
      // A second pointer during a drag: the point goes back, and the two pointers pinch.
      this.editor.cancelDrag()
      this.pointers.set(this.dragPointer, this.dragAt)
      this.dragPointer = null
    } else if (this.pointers.size === 0 && this.editor?.pointerDown(event)) {
      this.el.setPointerCapture(event.pointerId)
      this.dragPointer = event.pointerId
      this.dragAt = at
      return
    }
    // Only a lone press can be a tap; a second pointer makes it a pinch.
    this.tap = this.pointers.size === 0 ? {id: event.pointerId, ...at} : null
    this.el.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, at)
  },

  // The editor cancelled the drag (Escape) while its pointer is still down: that pointer pans.
  dragCancelled() {
    if (this.dragPointer === null) return
    this.pointers.set(this.dragPointer, this.dragAt)
    this.dragPointer = null
  },

  pointerMove(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragAt = {x: event.clientX, y: event.clientY}
      this.editor.moveDrag(event)
      return
    }
    const previous = this.pointers.get(event.pointerId)
    if (!previous) this.hover(event)
    if (!previous || !this.svg) return
    const current = {x: event.clientX, y: event.clientY}
    const tap = this.tap
    const moved = tap && Math.hypot(current.x - tap.x, current.y - tap.y) >= TAP_DISTANCE_PX
    if (tap?.id === event.pointerId && moved) this.tap = null

    if (this.pointers.size === 1) {
      const scale = this.pixelScale()
      this.setView(panBy(this.viewBox, (current.x - previous.x) / scale, (current.y - previous.y) / scale))
    } else if (this.pointers.size === 2) {
      const [other] = [...this.pointers].filter(([id]) => id !== event.pointerId).map(([, p]) => p)
      this.pinch(previous, current, other)
    }

    this.pointers.set(event.pointerId, current)
  },

  // One finger of a pinch moved from `previous` to `current` while the other stayed at `other`:
  // pan by the midpoint's move, then zoom around the new midpoint by the change in distance.
  pinch(previous, current, other) {
    const before = Math.hypot(previous.x - other.x, previous.y - other.y)
    const after = Math.hypot(current.x - other.x, current.y - other.y)
    if (before < 1 || after < 1) return

    const scale = this.pixelScale()
    const midBefore = {x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2}
    const midAfter = {x: (current.x + other.x) / 2, y: (current.y + other.y) / 2}
    const panned = panBy(
      this.viewBox,
      (midAfter.x - midBefore.x) / scale,
      (midAfter.y - midBefore.y) / scale,
    )
    this.viewBox = panned
    const point = this.toUser(midAfter.x, midAfter.y)
    this.setView(zoomAt(panned, point, before / after))
  },

  pointerUp(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = null
      this.editor.endDrag()
      this.relayoutIfStale()
      return
    }
    const tapped = this.tap?.id === event.pointerId && this.pointers.size === 1
    this.tap = null
    this.pointers.delete(event.pointerId)
    if (tapped && this.svg) this.editor?.tap(event)
    this.relayoutIfStale()
  },

  // The browser took the pointer away (or capture was lost): a drag ends without a change.
  pointerCancel(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = null
      this.editor.cancelDrag()
      this.relayoutIfStale()
      return
    }
    if (this.tap?.id === event.pointerId) this.tap = null
    this.pointers.delete(event.pointerId)
    this.relayoutIfStale()
  },

  // A mouse over a point shows the move cursor.
  hover(event) {
    if (event.pointerType !== "mouse" || !this.svg || !this.editor) return
    this.el.classList.toggle("cursor-move", this.editor.pick(event) !== null)
  },

  keyDown(event) {
    if (!this.svg || event.altKey || event.ctrlKey || event.metaKey) return
    const step = KEY_PAN_FRACTION * Math.min(this.viewBox.width, this.viewBox.height)
    const actions = {
      ArrowLeft: () => this.setView(panBy(this.viewBox, step, 0)),
      ArrowRight: () => this.setView(panBy(this.viewBox, -step, 0)),
      ArrowUp: () => this.setView(panBy(this.viewBox, 0, step)),
      ArrowDown: () => this.setView(panBy(this.viewBox, 0, -step)),
      "+": () => this.zoomBy(KEY_ZOOM_FACTOR),
      "=": () => this.zoomBy(KEY_ZOOM_FACTOR),
      "-": () => this.zoomBy(1 / KEY_ZOOM_FACTOR),
      "0": () => this.setView(this.fitted),
    }
    const action = actions[event.key]
    if (action) {
      event.preventDefault()
      action()
    }
  },
}

export default PatternView
