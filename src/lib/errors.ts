/**
 * Safe extractor for caught error values.
 * Used by call-sites that previously typed `catch (e: any)` and only needed `.message`.
 * Keeps behavior identical: Error → e.message; everything else → String(e).
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}
