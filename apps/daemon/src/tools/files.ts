import { writeTarget } from "../effect-scope.js";
import { executeCommand,hostConfinementAvailable } from '../execution.js';
import { getDefaultRedactor } from '../redact.js';
import { createHash } from "node:crypto";
import { ActionFailure } from "../action-receipts.js";
import { lstatSync, mkdirSync, realpathSync, writeFileSync, openSync,readSync,closeSync,fstatSync,constants, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { ToolDef } from "./registry.js";

export const botWorkDir = (dataDir: string, botId: string) => join(dataDir, "bots", botId, "work");

// `allowRoot` is for ancestors (may equal the root); the written file itself must be strictly inside.
const isInside = (root: string, target: string, allowRoot = false) => {
  const rel = relative(root, target);
  if (rel === "") return allowRoot;
  return !rel.startsWith("..") && !isAbsolute(rel);
};

function nearestExistingRealpath(p: string): string {
  let cur = p;
  for (;;) {
    try {
      return realpathSync(cur);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) throw new Error("no existing ancestor");
      cur = parent;
    }
  }
}

/** Writes `path` under the bot's work dir. Rejects `..`, absolute paths and symlink escapes. */
export function writeWorkFile(dataDir: string, botId: string, path: unknown, content: unknown): string {
  if (typeof path !== "string" || path === "") throw new Error("path must be a non-empty string");
  if (typeof content !== "string") throw new Error("content must be a string");
  const workDir = botWorkDir(dataDir, botId);
  mkdirSync(workDir, { recursive: true });
  const root = realpathSync(workDir);
  const target = resolve(root, path);
  if (!isInside(root, target)) throw new Error(`path escapes the work directory: ${path}`);
  if (!isInside(root, nearestExistingRealpath(dirname(target)), true)) {
    throw new Error(`path escapes the work directory via symlink: ${path}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error(`refusing to write through symlink: ${path}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  writeFileSync(target, content);
  return target;
}

/** A bounded, no-follow base snapshot for the exact file being reviewed. */
export function reviewWorkFile(dataDir: string,botId: string,path: string): Record<string,unknown> {
  const workDir=botWorkDir(dataDir,botId);
  mkdirSync(workDir,{recursive:true});
  const root=realpathSync(workDir),target=resolve(root,path);
  if(!isInside(root,target)||!isInside(root,nearestExistingRealpath(dirname(target)),true))throw new ActionFailure("File path escapes the work directory.","not-run");
  let fd: number;
  try{fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {path,baseDigest:"missing",before:"",source:"New file in this bot's private workspace"};throw error;}
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>65536)throw new ActionFailure("Existing file is too large or is not a regular text file. Inspect it separately before proposing this change.","not-run");
    const buffer=Buffer.alloc(65537);
    const bytes=buffer.subarray(0,readSync(fd,buffer,0,buffer.length,0));
    if(bytes.length>65536)throw new ActionFailure("File changed while its proposal was being prepared.","not-run");
    try{new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new ActionFailure("The reviewed file is not UTF-8 text.","not-run");}
    if(bytes.includes(0))throw new ActionFailure("The reviewed file contains binary data.","not-run");
    return {path,baseDigest:createHash("sha256").update(bytes).digest("hex"),before:bytes.toString("utf8"),beforeTruncated:false,source:"Current file in this bot's private workspace"};
  }finally{closeSync(fd);}
}

function privateWriteTarget(ctx: import('./registry.js').ToolExecContext, path: string): string {
  if(isAbsolute(path))throw new ActionFailure('Use a relative private-workspace path.','not-run');
  const root=writeTarget(ctx.permission?.workspace??botWorkDir(ctx.dataDir,ctx.botId));
  const target=writeTarget(resolve(root,path));
  if(!isInside(root,target))throw new ActionFailure('File path escapes the private workspace.','not-run');
  return target;
}

export const writeFileTool: ToolDef<{ path: string; content: string }> = {
  name: "write_file", offlineSafe:true,
  effectScope:(ctx,args)=>({kind:"paths",paths:[privateWriteTarget(ctx,args.path)]}),
  permission:ctx=>ctx.permission&&ctx.permission.mode!=='danger-full-access'&&!hostConfinementAvailable()?{approval:'deny',message:'Host filesystem confinement is unavailable for file writes.'}:ctx.permission?.mode==='read-only'?{approval:'review',execution:{...ctx.permission,mode:'workspace-write'}}:{approval:'allow'},
  class: "act-local",
  description: "Write a text file inside your private work directory. The user may need to approve it.",
  input: z.object({ path: z.string().describe("Relative path inside the work dir"), content: z.string() }),
  review: (ctx,args)=>reviewWorkFile(ctx.dataDir,ctx.botId,args.path),
  async execute(ctx, args) {
    const target=privateWriteTarget(ctx,args.path);
    if(ctx.review){
      if(ctx.review.path!==args.path)throw new ActionFailure("The edited path differs from the reviewed target. Request a new proposal.","not-run");
      const now=reviewWorkFile(ctx.dataDir,ctx.botId,args.path);
      if(now.baseDigest!==ctx.review.baseDigest)throw new ActionFailure("The file changed after review. Request a new proposal before writing.","not-run");
    }
    if(ctx.permission){
      const content=getDefaultRedactor().redactString(args.content);
      const script="const f=require('node:fs'),p=require('node:path'),v=JSON.parse(f.readFileSync(0,'utf8')),t=p.resolve(process.cwd(),v.path);f.mkdirSync(p.dirname(t),{recursive:true});const fd=f.openSync(t,f.constants.O_WRONLY|f.constants.O_CREAT|f.constants.O_NOFOLLOW,0o600);try{const s=f.fstatSync(fd);if(!s.isFile()||s.nlink!==1)throw Error('Write target is not a plain unlinked file');f.ftruncateSync(fd,0);f.writeFileSync(fd,v.content)}finally{f.closeSync(fd)}";
      const quote=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";
      const result=await executeCommand(ctx.permission,quote(process.execPath)+' -e '+quote(script),ctx.signal,30_000,ctx.assertPermission,JSON.stringify({path:target,content}));
      if(result.exitCode!==0||result.interrupted)throw Error('File write did not complete. Inspect the target before repeating.');
      if(!readFileSync(resolve(ctx.permission.workspace,args.path)).equals(Buffer.from(content)))throw Error('File readback differs from the proposed content. Inspect the target before repeating.');
      return {written:args.path};
    }
    const written = writeWorkFile(ctx.dataDir, ctx.botId, args.path, args.content);
    return { written: relative(botWorkDir(ctx.dataDir, ctx.botId), written) };
  },
};
