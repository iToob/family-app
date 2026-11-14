import { hash, verify } from "@node-rs/argon2";
import { DomainError } from "./core";

// Argon2id (algorithm 2) with OWASP-recommended parameters.
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string) {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash so failed lookups take the same time as real ones.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword("timing-equaliser-not-a-real-password");
  await verifyPassword(await dummyHash, password);
}

export function validatePassword(pw: string) {
  if (typeof pw !== "string" || pw.length < 8) throw new DomainError("Passwords need at least 8 characters.");
  if (pw.length > 200) throw new DomainError("That password is too long.");
}

export function validateUsername(u: string) {
  if (typeof u !== "string" || !/^[a-zA-Z0-9._@+-]{3,64}$/.test(u.trim())) {
    throw new DomainError("Usernames are 3–64 characters: letters, numbers, dots, dashes, underscores, or an email address.");
  }
}
