/**
 * Blob <-> binary string helpers.
 *
 * piexif (all flavours) works on "binary strings" (one char per byte), so we need
 * a chunked conversion - String.fromCharCode(...millions) blows the call stack.
 *
 * These helpers deliberately avoid FileReader so they also run in Node
 * (Blob and btoa are globals in Node 18+), which keeps EXIF code unit-testable.
 */

const CHUNK_SIZE = 0x8000; // 32 KiB

export async function blobToBytes(blob) {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

export function bytesToBinaryString(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return binary;
}

export async function blobToBinaryString(blob) {
  return bytesToBinaryString(await blobToBytes(blob));
}

export function binaryStringToBytes(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export function binaryStringToBlob(binary, type = 'image/jpeg') {
  return new Blob([binaryStringToBytes(binary)], { type });
}

export function bytesToBase64(bytes) {
  return btoa(bytesToBinaryString(bytes));
}

export async function blobToDataUrl(blob) {
  const bytes = await blobToBytes(blob);
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
