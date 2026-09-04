import path from "node:path";
import type { WritePolicy } from "./types";

export class WritePolicyError extends Error {
  readonly code = "write_policy_denied";
  constructor(message: string) {
    super(message);
    this.name = "WritePolicyError";
  }
}

export function assertControlledWrite(filename: string, policy: WritePolicy = {}): string {
  const raw = String(filename || "").trim();
  if (!raw) throw new WritePolicyError("empty filename");
  if (policy.denyAbsolute !== false && path.isAbsolute(raw)) {
    throw new WritePolicyError("absolute artifact path denied");
  }
  const norm = raw.replace(/\\/g, "/");
  if (norm.includes("..")) throw new WritePolicyError("path escape denied");
  const prefixes = policy.allowRelativePrefixes;
  if (prefixes && prefixes.length > 0) {
    const ok = prefixes.some((p) => norm === p || norm.startsWith(p.endsWith("/") ? p : `${p}/`));
    if (!ok) throw new WritePolicyError("filename prefix not allowed");
  }
  return norm;
}
