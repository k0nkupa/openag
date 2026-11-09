// Compatibility shim: the tool registry lives in ../tools/.
export { botWorkDir, writeWorkFile } from "../tools/files.js";
export { defaultTools } from "../tools/index.js";
export type { ToolExecContext, ToolExecutor, ToolRegistry } from "../tools/registry.js";
