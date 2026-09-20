import { describe, expect, it } from "vitest";
import { normalizeLinkTarget, parseMarkdown, slugHeading } from "../../src/domain/markdown";

describe("Markdown parsing", () => {
  it("parses wiki aliases, anchors, Markdown links, Unicode tags, and frontmatter", () => {
    const parsed = parseMarkdown(`---
tags: [project, "nested/work"]
---
# عنوان المشروع

See [[Folder/Note#Decision|the decision]] and [another](../Other%20Note.md#Heading).
Inline #تعلم/برمجة and #project.
`);
    expect(parsed.title).toBe("عنوان المشروع");
    expect(parsed.links).toEqual([
      expect.objectContaining({ kind: "wiki", target: "Folder/Note", alias: "the decision", anchor: "Decision" }),
      expect.objectContaining({ kind: "markdown", target: "../Other Note", alias: "another", anchor: "Heading" }),
    ]);
    expect(parsed.tags).toEqual(["nested/work", "project", "تعلم/برمجة"].sort((a, b) => a.localeCompare(b)));
  });

  it("ignores links and tags in code plus escaped wiki links", () => {
    const tick = String.fromCharCode(96);
    const parsed = parseMarkdown(`# Real title

\\[[Escaped]] and \\[escaped markdown](Hidden.md).

${tick}[[Inline]] #inline${tick}

~~~md
[[Fenced]] #fenced
~~~

[[Actual]] #actual
`);
    expect(parsed.links.map(({ target }) => target)).toEqual(["Actual"]);
    expect(parsed.tags).toEqual(["actual"]);
  });

  it("parses list frontmatter, wrapped destinations, and absent titles", () => {
    const parsed = parseMarkdown(`---
tags:
  - '#alpha'
  - beta/nested
---

[local]( <Folder/Note.md#Part> ) and plain text.
`);
    expect(parsed.title).toBeNull();
    expect(parsed.tags).toEqual(["alpha", "beta/nested"]);
    expect(parsed.links).toEqual([expect.objectContaining({ target: "Folder/Note", anchor: "Part" })]);
  });

  it("keeps malformed and remote links out of the local graph", () => {
    const parsed = parseMarkdown("[[broken\n[web](https://example.com) [anchor](#local) ![image](asset.png) [[Good]]");
    expect(parsed.links).toEqual([expect.objectContaining({ target: "Good" })]);
  });

  it("normalizes paths and Unicode heading anchors", () => {
    expect(normalizeLinkTarget("./Folder/../Note%20One.md?x=1")).toBe("Note One");
    expect(normalizeLinkTarget("bad%ZZ.md")).toBe("bad%ZZ");
    expect(slugHeading("  مرحباً، World!  ")).toBe("مرحبا-world");
  });
});
