export const MAX_COMPANY_LOGO_BYTES = 1_000_000;
export const COMPANY_LOGOS_BUCKET = "company-logos";

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function detectCompanyLogoMime(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    const headerLength = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
    const headerType = String.fromCharCode(...bytes.slice(12, 16));
    const hasDimensions = bytes.length >= 24 && bytes.slice(16, 20).some(Boolean) && bytes.slice(20, 24).some(Boolean);
    if (bytes.length >= 33 && headerLength === 13 && headerType === "IHDR" && hasDimensions) return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 20 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" &&
    ((bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0) === bytes.length - 8 &&
    ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16)))
  ) {
    return "image/webp";
  }
  return null;
}

export function validateCompanyLogo(logo) {
  if (logo == null) return { data: null };
  if (!logo || typeof logo !== "object" || typeof logo.data !== "string" || !MIME_EXTENSIONS[logo.mimeType]) {
    return { error: "El logotipo debe ser PNG, JPG o WEBP." };
  }
  if (logo.data.length > Math.ceil(MAX_COMPANY_LOGO_BYTES / 3) * 4) {
    return { error: "El logotipo no puede superar 1 MB." };
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(logo.data)) {
    return { error: "El archivo de logotipo no es válido." };
  }

  let binary;
  try {
    binary = atob(logo.data);
  } catch {
    return { error: "El archivo de logotipo no es válido." };
  }
  if (binary.length > MAX_COMPANY_LOGO_BYTES) return { error: "El logotipo no puede superar 1 MB." };

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const actualMime = detectCompanyLogoMime(bytes);
  if (!actualMime || actualMime !== logo.mimeType) {
    return { error: "El contenido del logotipo no coincide con su formato." };
  }

  return { data: bytes, mimeType: actualMime, extension: MIME_EXTENSIONS[actualMime] };
}