// Public API of the editor helpers (docs/adr/0008-pattern-editor.md): pure edits of a stored
// pattern definition, the undo/redo history, parameter display units and seam allowance edges
// (docs/adr/0011-markings-and-seam-allowance-storage.md), for the browser editor.

export {
  type EdgeAllowance,
  edgeAllowance,
  pickEdge,
  type ProjectSeamAllowances,
  readSeamAllowances,
  setDefaultAllowance,
  setEdgeAllowance,
} from "./edges";
export {
  controlPoints,
  type EditorField,
  errorsFor,
  getPoint,
  pickPoint,
  pointFields,
  type RawDefinition,
  type RawPoint,
  roundOffset,
  setPointFormula,
  setUserOffset,
  type TryResult,
  tryPattern,
} from "./edits";
export {
  canRedo,
  canUndo,
  createHistory,
  type EditorState,
  HISTORY_LIMIT,
  type History,
  push,
  redo,
  undo,
} from "./history";
export {
  formatDisplay,
  fromDisplay,
  MAX_PARAMETER,
  type ParameterUnit,
  toDisplay,
} from "./units";
