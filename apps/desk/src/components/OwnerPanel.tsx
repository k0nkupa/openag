import { Disclosure } from "./Disclosure";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ApiError, messageOf, whoamiWithToken } from "../api";
import { clearOwnerToken, getOwnerToken, setOwnerToken, subscribeOwnerToken } from "../ownerSession";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const NOT_OWNER = "That is not the owner token";
const IS_DEVICE = "That is a device token, not the owner token";

export function OwnerPanel() {
  const held = useSyncExternalStore(subscribeOwnerToken, getOwnerToken, getOwnerToken) !== null;
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    const candidate = value.trim();
    setValue("");
    if (candidate.length === 0) return;
    setChecking(true);
    setError(null);
    try {
      const who = await whoamiWithToken(candidate);
      if (who.kind === "owner") setOwnerToken(candidate);
      else setError(IS_DEVICE);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? NOT_OWNER : messageOf(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">For Full access, ask a trusted full-access device to change this device in Settings, Devices. Or run <code>pnpm desk:open</code> on the computer running OpenAg to pair this browser again. No owner token is needed.</p>
      <Disclosure title={<> Legacy owner token </>}>
      <p role="status">Owner actions: {held ? "unlocked" : "locked"}</p>
      {held ? (
        <Button variant="outline" type="button" onClick={() => clearOwnerToken()}>
          Lock
        </Button>
      ) : (
        <form noValidate onSubmit={unlock}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="owner-token">Owner token</FieldLabel>
              <Input
                id="owner-token"
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={checking}>
              {checking ? "Checking..." : "Unlock"}
            </Button>
          </FieldGroup>
        </form>
      )}
      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}
      <p className="text-sm text-muted-foreground">
        Held in memory only: gone when you reload or close the tab. Used only for actions that need the owner.
      </p>
      </Disclosure>
    </div>
  );
}
