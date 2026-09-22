import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY_HEX = process.env.DATA_ENC_KEY;
const key = KEY_HEX && KEY_HEX.length === 64 ? Buffer.from(KEY_HEX, "hex") : null;

/** AES-256-GCM encrypt the user's Gemini key. Falls back to plaintext+prefix in dev if no key set. */
export function encryptSecret(plain: string): Buffer {
  if (!key) return Buffer.concat([Buffer.from("dev:"), Buffer.from(plain, "utf8")]);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptSecret(buf: Buffer): string {
  if (!key) return buf.subarray(4).toString("utf8");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
