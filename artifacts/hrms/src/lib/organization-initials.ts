/**
 * Initials for an organization's logo fallback (WS-25 Organization Branding).
 *
 * Deterministic and neutral: the first letter of the first and last word of
 * the organization's own display name, upper-cased, at most two characters.
 * Used only as a placeholder when no logo exists or its image failed to load
 * — never as a substitute for a real logo.
 *
 *   "Worldwide Word Ministries" → "WM"
 *   "Acme"                      → "A"
 *   ""                          → ""
 */
export function organizationInitials(name: string | null | undefined): string {
  if (!name) return '';
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);
  if (words.length === 0) return '';
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
