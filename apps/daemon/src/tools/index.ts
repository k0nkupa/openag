import {commandTool} from './execution.js';
import { createBraveTool } from "./brave.js";
import { writeFileTool } from "./files.js";
import { inspectionTools } from './inspection.js';
import { type ToolDef, type ToolRegistry, toExecutors } from "./registry.js";

export const defaultToolDefs: ToolDef[] = [...inspectionTools,writeFileTool, createBraveTool(),commandTool];
export const defaultTools: ToolRegistry = toExecutors(defaultToolDefs);
