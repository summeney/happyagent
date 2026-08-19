/** 工具集合：一处导出，供 agent / graph 绑定。 */
import { readFileTool } from "./read_file.js";
import { listDirTool } from "./list_dir.js";
import { writeFileTool } from "./write_file.js";
import { runBashTool } from "./run_bash.js";
import { grepTool } from "./grep.js";
import { editFileTool } from "./edit_file.js";

/** 最小四件套：读 / 列目录 / 写 / 跑命令。 */
export const coreTools = [readFileTool, listDirTool, writeFileTool, runBashTool];

/** 完整工具集（在四件套基础上增补 grep / edit_file）。 */
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
