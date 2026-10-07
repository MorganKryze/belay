import { DrizzleQueryError } from "drizzle-orm/errors";

// What the server prints about an error: name, message and code, never the object with its cause
// chain. A database error's message carries the query and its parameters (identifiers, health
// data), so for those only the name and the SQLSTATE code are printed.
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  if (err instanceof DrizzleQueryError) {
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    return `DrizzleQueryError${typeof code === "string" ? ` (code ${code})` : ""}`;
  }
  const code = (err as { code?: unknown }).code;
  const suffix = typeof code === "string" || typeof code === "number" ? ` (code ${code})` : "";
  return `${err.name}: ${err.message}${suffix}`;
}
