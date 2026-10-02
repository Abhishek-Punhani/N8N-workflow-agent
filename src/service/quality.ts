/** A municipality alone is not a usable business street address. This is a
 * completeness check, not a claim that the physical location was independently verified. */
export function isCompleteAddress(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    text.length >= 15 &&
    text.split(/\s+/).length >= 3 &&
    (/\d/.test(text) || text.split(/\s+/).length >= 6)
  );
}
