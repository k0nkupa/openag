import { useEffect, useRef, useState } from "react";
import { messageOf } from "../api";
import { useProfile } from "../profile";
import { useUnsavedChanges } from "../unsaved-changes";
import { ProfileImageEditor } from "./ProfileImageEditor";
import { openProfileImage } from "../profile-image";
import { UserAvatar } from "./UserAvatar";
import { SettingsHeader, SettingsSection } from "./SettingsLayout";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export function ProfileSettings({ canManage }: { canManage: boolean }) {
  const { profile, loading, error: loadError, save } = useProfile();
  const [draft, setDraft] = useState(profile);
  const [base, setBase] = useState(profile);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const active = useRef(true), selecting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.src); }, [image]);
  async function choose(file: File) {
    if (selecting.current || !canManage) return;
    selecting.current = true; setReading(true); setError(null); setSaved(false);
    try {
      const loaded = await openProfileImage(file);
      if (active.current) setImage(loaded); else URL.revokeObjectURL(loaded.src);
    } catch (err) { if (active.current) setError(messageOf(err)); }
    finally { selecting.current = false; if (active.current) setReading(false); }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useUnsavedChanges(dirty, busy || reading);
  useEffect(() => {
    if (!dirty) { setDraft(profile); setBase(profile); }
  }, [profile, dirty]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || !canManage || loading || reading || loadError) return;
    saving.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      const next = { ...draft, name: draft.name.trim() };
      await save(next); setDraft(next); setBase(next); setSaved(true);
    } catch (err) { setError(messageOf(err)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="flex min-w-0 flex-col gap-6" aria-labelledby="profile-title">
    <SettingsHeader id="profile-title" title="Profile" description="Choose the name and avatar shown with your messages." />
    {(error || loadError) && <Alert variant="destructive"><AlertDescription>{error || loadError}</AlertDescription></Alert>}
    {reading && <p role="status">Reading image…</p>}
    {loading && <p role="status">Loading profile…</p>}
    {!canManage && <p className="text-sm text-muted-foreground">Full access is required to edit the profile.</p>}
    <SettingsSection icon="settings" title="Your profile">
      <form className="flex flex-col gap-5" onSubmit={submit} onChange={() => setSaved(false)}>
        <fieldset disabled={!canManage || loading || busy || reading || !!loadError} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <div className="flex flex-wrap items-center gap-3">
            <UserAvatar profile={draft} size={64} />
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload avatar image" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choose(file); }} />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>Upload image</Button>
            {draft.avatar && <Button type="button" variant="ghost" onClick={() => { setDraft(current => ({ ...current, avatar: null })); setSaved(false); }}>Remove image</Button>}
          </div>
          <p className="m-0 text-sm text-muted-foreground">JPG, PNG or WebP, up to 5 MiB. Saved as a small cropped image.</p>
          <Field><FieldLabel htmlFor="profile-name">Name</FieldLabel><Input id="profile-name" autoComplete="nickname" required maxLength={40} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!dirty || !draft.name.trim()}>{busy ? "Saving…" : "Save profile"}</Button>
            {dirty && <Button type="button" variant="ghost" onClick={() => { setDraft(profile); setBase(profile); setError(null); setSaved(false); }}>Cancel</Button>}
          </div>
        </fieldset>
        {saved && <p role="status" className="text-sm text-muted-foreground">Profile saved.</p>}
      </form>
    </SettingsSection>
    <Dialog open={!!image} onOpenChange={open => { if (!open) setImage(null); }}>
      <DialogContent className="sm:max-w-md">
        {image && <ProfileImageEditor image={image} onSave={avatar => { setDraft(current => ({ ...current, avatar })); setSaved(false); }} close={() => setImage(null)} />}
      </DialogContent>
    </Dialog>
  </section>;
}
