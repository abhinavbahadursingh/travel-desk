import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Password hashing using Node's built-in scrypt (salt + 64-byte key, hex
// encoded). No third-party dependency is required and the parameters are
// memory-hard, which is the current recommended baseline.
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { salt, hash };
}

export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): boolean {
  const hash = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}
