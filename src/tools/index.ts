/** 工具集合：一处导出，供 agent / graph 绑定。 */
import { readFileTool } from "./read_file.js";
import { listDirTool } from "./list_dir.js";
import { writeFileTool } from "./write_file.js";
import { runBashTool } from "./run_bash.js";
import { grepTool } from "./grep.js";
import { editFileTool } from "./edit_file.js";

/** Phase 1 的最小四件套。 */
export const coreTools = [readFileTool, listDirTool, writeFileTool, runBashTool];

/** Phase 2 起的完整工具集（增补 grep / edit_file）。 */
export const allTools = [...coreTools, grepTool, editFileTool];

export {
  readFileTool,
  listDirTool,
  writeFileTool,
  runBashTool,
  grepTool,
  editFileTool,
};
export { setBashApprovalEnabled } from "./run_bash.js";
