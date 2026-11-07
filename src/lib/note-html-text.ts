import { DomUtils, ElementType, parseDocument } from "htmlparser2";
import { tagKey, tagMatches } from "./note-tags";

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
type TextNode = Extract<HtmlNode, { type: typeof ElementType.Text }>;
const blocks = /^(?:p|div|h[1-6]|blockquote|pre|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|br|hr|img)$/;

function textRuns(html: string) {
  const doc = parseDocument(html);
  const runs: TextNode[][] = [];
  let current: TextNode[] = [];
  const boundary = () => {
    if (current.length) runs.push(current);
    current = [];
  };
  const visit = (node: HtmlNode) => {
    if (node.type === ElementType.Text) {
      current.push(node);
    } else if (node.type === ElementType.Tag) {
      if (node.name === "script" || node.name === "style" || node.name === "template") return;
      const separate = blocks.test(node.name);
      if (separate) boundary();
      node.children.forEach(visit);
      if (separate) boundary();
    }
  };
  doc.children.forEach(visit);
  boundary();
  return { doc, runs };
}

export function htmlToPlainText(html: string) {
  return textRuns(html).runs.map((run) => run.map((node) => node.data).join("").trim())
    .filter(Boolean).join("\n").replace(/\u200B/g, "");
}

export function replaceHtmlTag(html: string, from: string, to: string | null) {
  const { doc, runs } = textRuns(html);
  let changed = false;
  for (const nodes of runs) {
    const text = nodes.map((node) => node.data).join("");
    const matches = [...tagMatches(text)].filter(([tag]) => tagKey(tag) === from);
    for (const match of matches.reverse()) {
      const start = match.index;
      const end = start + match[0].length;
      let offset = 0;
      for (const node of nodes) {
        const next = offset + node.data.length;
        if (offset < end && next > start) {
          const left = Math.max(0, start - offset);
          const right = Math.min(node.data.length, end - offset);
          const replacement = offset <= start && to ? `#${to}` : "";
          node.data = node.data.slice(0, left) + replacement + node.data.slice(right);
          changed = true;
        }
        offset = next;
        if (offset >= end) break;
      }
    }
  }
  return changed ? DomUtils.getOuterHTML(doc, { encodeEntities: "utf8" }) : html;
}
