import { useEffect, useRef } from "react";
import { resolveLeave, useLeavePrompt } from "../unsaved-changes";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "./ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { XIcon } from "lucide-react";
import { Button } from "./ui/button";

/** Kept outside route content so portal-hosted drafts remain mounted while choosing. */
export function NavigationDialogs() {
  const prompt = useLeavePrompt();
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (prompt) opener.current = prompt.opener;
  useEffect(() => () => resolveLeave(), []);
  return <>
    <AlertDialog open={prompt?.kind === "discard"} onOpenChange={open => { if (!open) resolveLeave(); }}>
      <AlertDialogContent onOutsidePress={() => resolveLeave()} initialFocus={cancel} finalFocus={opener}>
        <Button variant="ghost" size="icon-sm" aria-label="Close" className="absolute right-2 top-2" onClick={() => resolveLeave()}><XIcon /></Button>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Keep editing to preserve your draft, or discard your changes and leave.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel ref={cancel}>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => resolveLeave(true)}>Discard changes</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={prompt?.kind === "busy"} onOpenChange={open => { if (!open) resolveLeave(); }}>
      <DialogContent finalFocus={opener}><DialogHeader><DialogTitle>Operation in progress</DialogTitle><DialogDescription>A save or configuration check is still in progress. Wait for its result before leaving. Nothing will navigate automatically.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => resolveLeave()}>Stay here</Button></DialogFooter></DialogContent>
    </Dialog>
  </>;
}
