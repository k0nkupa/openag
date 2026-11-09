import { connectorCredentialStore } from "./connector-credentials.js";

// Preserve the existing Google filename and authenticated encryption format.
export const googleCredentialStore = (dataDir: string, keyHex: string) => connectorCredentialStore(dataDir, keyHex, "google");
