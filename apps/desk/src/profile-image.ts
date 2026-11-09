export const PROFILE_UPLOAD_MAX = 5 * 1024 * 1024;
export const PROFILE_IMAGE_MAX = 64 * 1024;
export const PROFILE_IMAGE_SIZE = 256;

export function cropImage(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / zoom;
  return { left: (width - size) * x, top: (height - size) * y, size };
}

export async function openProfileImage(file: File): Promise<HTMLImageElement> {
  if (!file.size || file.size > PROFILE_UPLOAD_MAX) throw Error("Choose an image up to 5 MiB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw Error("Choose a JPG, PNG or WebP image.");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = file.type === "image/jpeg" ? header[0] === 255 && header[1] === 216 && header[2] === 255
    : file.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)
    : String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!signature) throw Error("This file is not a valid JPG, PNG or WebP image.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 20_000_000) throw Error("Choose an image with at most 20 megapixels.");
    return image;
  } catch (error) { URL.revokeObjectURL(url); throw error instanceof DOMException ? Error("Could not read this image. Choose another JPG, PNG or WebP.") : error; }
}

export async function saveProfileImage(image: HTMLImageElement, zoom: number, x: number, y: number): Promise<string> {
  const crop = cropImage(image.naturalWidth, image.naturalHeight, zoom, x, y);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PROFILE_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw Error("Image editing is unavailable in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, crop.left, crop.top, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.type !== "image/jpeg" || blob.size > PROFILE_IMAGE_MAX) throw Error("The cropped image is too large. Try another image.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("Could not prepare your image. Try again."));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
