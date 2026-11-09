import {useState} from "react";

// Session drafts survive a reload in this tab. Clear them only after the server records the response.
export function useSessionDraft(key:string,initial=""){
 const storageKey="openag-draft:"+key;
 const [text,setText]=useState(()=>{try{return sessionStorage.getItem(storageKey)??initial;}catch{return initial;}});
 return [text,(value:string)=>{setText(value);try{if(value)sessionStorage.setItem(storageKey,value);else sessionStorage.removeItem(storageKey);}catch{/* Storage can be disabled. The in-memory draft still works. */}}] as const;
}
