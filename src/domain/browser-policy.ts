import { isAbsolute, relative, sep } from "node:path";

export class BrowserBoundaryError extends Error {}

export const BROWSER_START_URL = "data:text/html;charset=utf-8,%3Ctitle%3ENew%20tab%3C%2Ftitle%3E%3Cstyle%3Ebody%7Bbackground%3A%230c111b%3Bcolor%3A%238f9bad%3Bfont%3A16px%20system-ui%3Bdisplay%3Agrid%3Bplace-items%3Acenter%3Bheight%3A100vh%3Bmargin%3A0%7D%3C%2Fstyle%3E%3Cp%3EEnter%20an%20address%20to%20start%20browsing.%3C%2Fp%3E";

export function normalizeBrowserUrl(input: string) {
  const value = input.trim();
  if (!value) return BROWSER_START_URL;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && /\s/.test(value)) return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withProtocol);
  if (!(["http:", "https:", "data:"].includes(parsed.protocol))) throw new BrowserBoundaryError("Only HTTP and HTTPS pages can be opened.");
  if (parsed.protocol === "data:" && withProtocol !== BROWSER_START_URL) throw new BrowserBoundaryError("Data URLs are reserved for the built-in new tab page.");
  return parsed.toString();
}

export function containsPath(parent: string, child: string) {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

export function decodeArtifactPath(pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new BrowserBoundaryError("Invalid artifact path encoding."); }
  const normalized = decoded.replace(/^\/+/, "").replaceAll("\\", "/");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "." || !part)) throw new BrowserBoundaryError("Artifact path escapes are not allowed.");
  return normalized;
}
