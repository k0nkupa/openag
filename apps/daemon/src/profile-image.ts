import { imageDimensions } from "./uploads.js";

const PREFIX = "data:image/jpeg;base64,";
const MAX_BYTES = 64 * 1024;
export const PROFILE_IMAGE_MAX_LENGTH = PREFIX.length + Math.ceil(MAX_BYTES / 3) * 4;
// shortcut: validates cropped JPEG headers; add full decoding before accepting original image uploads.
export function validProfileImage(value: string): boolean {
  if (!value.startsWith(PREFIX) || value.length > PROFILE_IMAGE_MAX_LENGTH) return false;
  const encoded = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_BYTES || bytes.toString("base64") !== encoded || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
  try {
    const { width, height } = imageDimensions(bytes, "image/jpeg");
    return width === 256 && height === 256;
  } catch { return false; }
}
