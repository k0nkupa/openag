import { useEffect, useRef, useState } from "react";
import { Download, File } from "lucide-react";
import { messageOf, type Api } from "../api";
import type { Attachment } from "../types";
import { Attachment as AttachmentSurface, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions, AttachmentAction } from "./ui/attachment";

export function AttachmentChip({ api, roomId, attachment }: { api: Api; roomId: string; attachment: Attachment }) {
  const chip = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!chip.current || !["image/png", "image/jpeg"].includes(attachment.mimeType)) return;
    let active = true, url: string | undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void api.downloadAttachment(roomId, attachment.id).then(blob => { if (active) { url = URL.createObjectURL(blob); setPreview(url); } }).catch(err => { if (active) setError(messageOf(err)); });
    });
    observer.observe(chip.current);
    return () => { active = false; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [api, roomId, attachment.id, attachment.mimeType]);
  async function download() {
    setBusy(true); setError(undefined);
    try {
      const blob = await api.downloadAttachment(roomId, attachment.id);
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = attachment.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <AttachmentSurface ref={chip} size="sm" state={error ? "error" : busy ? "processing" : "done"}>
    <AttachmentMedia variant={preview ? "image" : "icon"}>{preview ? <img src={preview} alt="" /> : <File />}</AttachmentMedia>
    <AttachmentContent><AttachmentTitle>{attachment.name}</AttachmentTitle><AttachmentDescription>{attachment.bytes.toLocaleString()} bytes · Input attachment</AttachmentDescription>{error && <AttachmentDescription role="alert">{error}</AttachmentDescription>}</AttachmentContent>
    <AttachmentActions><AttachmentAction disabled={busy} onClick={() => void download()} aria-label={`Download ${attachment.name}`}><Download data-icon="inline-start" /></AttachmentAction></AttachmentActions>
  </AttachmentSurface>;
}
