import { posix } from "node:path";

export type ParsedLink = {
  kind: "wiki" | "markdown";
  target: string;
  alias: string | null;
  anchor: string | null;
  startOffset: number;
  endOffset: number;
};

export type ParsedMarkdown = {
  title: string | null;
  links: ParsedLink[];
  tags: string[];
};

function maskRange(characters: string[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n") characters[index] = " ";
  }
}

function searchableMarkdown(content: string) {
  const characters = [...content];
  for (const match of content.matchAll(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm)) {
    maskRange(characters, match.index!, match.index! + match[0].length);
  }
  for (const match of content.matchAll(/`+[^`\n]*`+/g)) {
    maskRange(characters, match.index!, match.index! + match[0].length);
  }
  return characters.join("");
}

function isEscaped(content: string, offset: number) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && content[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function splitTarget(value: string) {
  const aliasIndex = value.indexOf("|");
  const withAnchor = aliasIndex >= 0 ? value.slice(0, aliasIndex) : value;
  const alias = aliasIndex >= 0 ? value.slice(aliasIndex + 1).trim() || null : null;
  const anchorIndex = withAnchor.indexOf("#");
  const target = (anchorIndex >= 0 ? withAnchor.slice(0, anchorIndex) : withAnchor).trim();
  const anchor = anchorIndex >= 0 ? withAnchor.slice(anchorIndex + 1).trim() || null : null;
  return { target, alias, anchor, targetLength: anchorIndex >= 0 ? anchorIndex : withAnchor.length };
}

export function normalizeLinkTarget(target: string) {
  const withoutQuery = target.split("?")[0];
  const decoded = (() => { try { return decodeURIComponent(withoutQuery); } catch { return withoutQuery; } })();
  return posix.normalize(decoded.replaceAll("\\", "/").replace(/^\.\//, "")).replace(/\.md$/i, "");
}

function frontmatterTags(content: string) {
  if (!content.startsWith("---\n")) return [];
  const end = content.indexOf("\n---", 4);
  if (end < 0) return [];
  const block = content.slice(4, end);
  const lines = block.split("\n");
  const tags: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^tags\s*:\s*(.*)$/i.exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.startsWith("[") && inline.endsWith("]")) {
      tags.push(...inline.slice(1, -1).split(",").map((tag) => tag.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean));
    } else if (inline) {
      tags.push(...inline.split(/[ ,]+/).filter(Boolean));
    } else {
      for (let child = index + 1; child < lines.length; child += 1) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(lines[child]);
        if (!item) break;
        tags.push(item[1].replace(/^['"]|['"]$/g, ""));
      }
    }
    break;
  }
  return tags;
}

export function parseMarkdown(content: string): ParsedMarkdown {
  const searchable = searchableMarkdown(content);
  const links: ParsedLink[] = [];

  for (const match of searchable.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    if (isEscaped(content, match.index!)) continue;
    const parsed = splitTarget(match[1]);
    if (!parsed.target) continue;
    const targetStart = match.index! + 2;
    links.push({ kind: "wiki", target: normalizeLinkTarget(parsed.target), alias: parsed.alias, anchor: parsed.anchor, startOffset: targetStart, endOffset: targetStart + parsed.targetLength });
  }

  for (const match of searchable.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    if (isEscaped(content, match.index!)) continue;
    const rawDestination = match[2].trim();
    const unwrapped = rawDestination.startsWith("<") && rawDestination.endsWith(">") ? rawDestination.slice(1, -1) : rawDestination;
    if (/^(?:[a-z]+:|#)/i.test(unwrapped)) continue;
    const hashIndex = unwrapped.indexOf("#");
    const rawTarget = hashIndex >= 0 ? unwrapped.slice(0, hashIndex) : unwrapped;
    if (!rawTarget) continue;
    const destinationOffset = match[0].lastIndexOf(match[2]);
    const wrappingOffset = rawDestination.startsWith("<") ? 1 : 0;
    const leadingWhitespace = match[2].length - match[2].trimStart().length;
    const targetStart = match.index! + destinationOffset + leadingWhitespace + wrappingOffset;
    links.push({
      kind: "markdown",
      target: normalizeLinkTarget(rawTarget),
      alias: match[1],
      anchor: hashIndex >= 0 ? unwrapped.slice(hashIndex + 1) || null : null,
      startOffset: targetStart,
      endOffset: targetStart + rawTarget.length,
    });
  }

  const tags = new Set(frontmatterTags(content).map((tag) => tag.replace(/^#/, "")));
  for (const match of searchable.matchAll(/(^|[\s(])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gmu)) tags.add(match[2]);
  const titleMatch = /^#\s+(.+?)\s*$/m.exec(searchable);
  return { title: titleMatch?.[1] ?? null, links, tags: [...tags].sort((a, b) => a.localeCompare(b)) };
}

export function slugHeading(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
