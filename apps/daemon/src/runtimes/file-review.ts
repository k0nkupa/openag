import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { ActionFailure } from "../action-receipts.js";
import { botWorkDir, reviewWorkFile } from "../tools/files.js";

interface FileChange { path:string;before:string;baseDigest:string;after:string|null;afterDigest:string }
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
const refuse=(message:string):never=>{throw new ActionFailure(message,"not-run");};
function replace(before:string,oldText:unknown,newText:unknown,all=false):string {
  if(typeof oldText!=="string"||typeof newText!=="string")return refuse("The adapter did not supply an exact text change.");
  if(!oldText)return before===""?newText:refuse("An empty edit cannot replace an existing file.");
  const at=before.indexOf(oldText);
  if(at<0||(!all&&before.indexOf(oldText,at+oldText.length)>=0))return refuse("The proposed edit does not match the current file uniquely.");
  return all?before.split(oldText).join(newText):before.slice(0,at)+newText+before.slice(at+oldText.length);
}
export function nativeFileReview(dataDir:string,botId:string,tool:string,args:unknown):Record<string,unknown>|undefined {
  if(!["Write","Edit","MultiEdit","NotebookEdit","codex.edit"].includes(tool))return;
  const body=args as Record<string,unknown>;
  if(!body||typeof body!=="object")return refuse("No inspectable native file proposal was supplied. Use the daemon write_file tool.");
  const files=new Map<string,FileChange>();
  const file=(raw:unknown)=>{
    if(typeof raw!=="string"||!raw)return refuse("No affected file path was supplied.");
    const root=botWorkDir(dataDir,botId),path=relative(root,isAbsolute(raw)?resolve(raw):resolve(root,raw));
    if(!path||isAbsolute(path)||path.startsWith(".."))return refuse("Native file changes must stay in this bot's private workspace.");
    let f=files.get(path);
    if(!f){const base=reviewWorkFile(dataDir,botId,path);f={path,before:base.before as string,baseDigest:base.baseDigest as string,after:base.before as string,afterDigest:""};files.set(path,f);}
    return f;
  };
  if(tool==="Write"){
    if(typeof body.content!=="string")return refuse("A complete proposed file is required.");
    file(body.file_path??body.path).after=body.content;
  }else if(tool==="Edit"||tool==="MultiEdit"){
    const f=file(body.file_path??body.path),edits=tool==="MultiEdit"?body.edits:[body];
    if(!Array.isArray(edits)||!edits.length||edits.length>32)return refuse("The native edit list is unavailable or too large.");
    for(const e of edits)f.after=replace(f.after??"",e.old_string,e.new_string,e.replace_all===true);
  }else if(tool==="codex.edit"){
    if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>32)return refuse("The adapter omitted the file diff. Use the daemon write_file tool for a complete proposal.");
    for(const change of body.changes){
      if(change?.type!=="diff")return refuse("The native file proposal contains an unsupported change.");
      const f=file(change.path),kind=change._meta?.kind;
      if(kind==="delete"){
        if(change.oldText!==f.before)return refuse("Deletion must show the complete current file.");f.after=null;
      }else if(change.oldText===null){
        if(f.baseDigest!=="missing"||typeof change.newText!=="string")return refuse("A proposed new file already exists.");f.after=change.newText;
      }else f.after=replace(f.after??"",change.oldText,change.newText);
    }
  }else return refuse("This native file format cannot be reviewed safely. Use the daemon write_file tool.");
  for(const f of files.values()){
    if(f.after!==null&&Buffer.byteLength(f.after)>65536)return refuse("The proposed native file exceeds the review limit.");
    f.afterDigest=f.after===null?"missing":digest(f.after);
  }
  return {nativeFiles:[...files.values()],source:"Daemon file snapshots and the adapter's exact proposed changes"};
}
export function checkNativeFiles(dataDir:string,botId:string,review:Record<string,unknown>|null,after=false):boolean {
  const files=review?.nativeFiles as FileChange[]|undefined;
  if(!files?.length)return false;
  return files.every(file=>reviewWorkFile(dataDir,botId,file.path).baseDigest===(after?file.afterDigest:file.baseDigest));
}
