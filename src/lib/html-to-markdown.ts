/**
 * Chuyển HTML của ghi chú (do trình soạn thảo contenteditable tạo ra) thành
 * Markdown. Chạy trên client bằng DOMParser — hỗ trợ: h1–h3, đoạn văn, in
 * đậm/nghiêng/gạch chân/gạch ngang, danh sách (chấm/gạch/số/checklist lồng
 * nhau), trích dẫn, bảng, ảnh, liên kết, mã, tô sáng, đường kẻ ngang.
 */

type BlockCtx = { depth: number };

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function cssBold(el: HTMLElement, text: string) {
  const weight = el.style.fontWeight;
  if (weight !== "bold" && weight !== "bolder" && !(Number(weight) >= 600)) return text;
  return text.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, "$1**$2**$3");
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;

  // Ảnh / liên kết
  if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt") || "ảnh";
    const src = el.getAttribute("src") || "";
    return `![${alt}](${src})`;
  }
  if (el.tagName === "A") {
    const href = el.getAttribute("href") || "";
    const text = inlineChildren(el).trim() || href;
    return href ? `[${text}](${href})` : text;
  }

  switch (el.tagName) {
    case "BR":
      return "\n";
    case "B":
    case "STRONG": {
      const t = inlineChildren(el).trim();
      return t ? `**${t}**` : "";
    }
    case "I":
    case "EM": {
      const t = inlineChildren(el).trim();
      return t ? `*${t}*` : "";
    }
    case "U":
      return inlineChildren(el); // Markdown thuần không có gạch chân → giữ text
    case "S":
    case "STRIKE":
    case "DEL": {
      const t = inlineChildren(el).trim();
      return t ? `~~${t}~~` : "";
    }
    case "CODE": {
      const t = el.textContent ?? "";
      return t.trim() ? `\`${t}\`` : "";
    }
    case "MARK": {
      const t = inlineChildren(el).trim();
      return t ? `==${t}==` : "";
    }
    default:
      return cssBold(el, inlineChildren(el));
  }
}

function inlineChildren(el: Node): string {
  let out = "";
  el.childNodes.forEach((c) => {
    out += inline(c);
  });
  // Gộp các dòng do <br> trong cùng đoạn: giữ nguyên \n, chỉ dọn khoảng trắng
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function listMarker(ul: HTMLElement | null, index: number, li: HTMLElement): string {
  if (ul && ul.classList.contains("taskList")) {
    return li.classList.contains("checked") ? "- [x] " : "- [ ] ";
  }
  if (ul && ul.classList.contains("dashed")) return "- ";
  if (ul) return "- ";
  return `${index + 1}. `;
}

function renderListItem(li: HTMLElement, ul: HTMLElement | null, index: number, depth: number): string {
  const pad = "  ".repeat(depth);
  const marker = listMarker(ul, index, li);

  // Tách nội dung inline của li và các danh sách con
  let text = "";
  const nested: string[] = [];
  li.childNodes.forEach((c) => {
    if (c.nodeType === Node.ELEMENT_NODE) {
      const tag = (c as HTMLElement).tagName;
      if (tag === "UL" || tag === "OL") {
        nested.push(renderList(c as HTMLElement, depth + 1));
        return;
      }
    }
    text += inline(c);
  });

  const lines = text.replace(/\u200B/g, "").split("\n");
  let out = `${pad}${marker}${(lines[0] ?? "").trim()}`.trimEnd() + "\n";
  for (const extra of lines.slice(1)) {
    const t = extra.trim();
    if (t) out += `${pad}  ${t}\n`;
  }
  for (const n of nested) out += n;
  return out;
}

function renderList(list: HTMLElement, depth: number): string {
  let out = "";
  let i = 0;
  list.querySelectorAll(":scope > li").forEach((li) => {
    out += renderListItem(li as HTMLElement, list.tagName === "UL" ? list : null, i, depth);
    i++;
  });
  return out;
}

function renderBlock(el: HTMLElement, ctx: BlockCtx): string {
  switch (el.tagName) {
    case "H1":
      return `# ${inlineChildren(el).trim()}\n\n`;
    case "H2":
      return `## ${inlineChildren(el).trim()}\n\n`;
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return `### ${inlineChildren(el).trim()}\n\n`;
    case "P":
    case "DIV": {
      // DIV chứa danh sách/bảng lồng (hiếm) → xử lý đệ quy
      const hasBlocks = el.querySelector(":scope > ul, :scope > ol, :scope > table, :scope > blockquote");
      if (hasBlocks) {
        let out = "";
        el.childNodes.forEach((c) => {
          if (c.nodeType === Node.ELEMENT_NODE) out += renderBlock(c as HTMLElement, ctx);
          else out += inline(c);
        });
        return out;
      }
      const t = cssBold(el, inlineChildren(el)).replace(/\u200B/g, "").trim();
      return t ? `${t}\n\n` : "";
    }
    case "UL":
    case "OL":
      return renderList(el, 0) + "\n";
    case "BLOCKQUOTE": {
      const inner = inlineChildren(el).replace(/\u200B/g, "").trim();
      if (!inner) return "";
      return inner.split("\n").map((l) => `> ${l.trim()}`.trimEnd()).join("\n") + "\n\n";
    }
    case "HR":
      return "---\n\n";
    case "TABLE": {
      const rows = Array.from(el.querySelectorAll("tr"));
      if (rows.length === 0) return "";
      const cells = (tr: HTMLTableRowElement) =>
        Array.from(tr.cells).map((td) => escapeCell(td.textContent ?? ""));
      const head = cells(rows[0]);
      const width = head.length || 1;
      let out = `| ${Array.from({ length: width }, (_, i) => head[i] ?? " ").join(" | ")} |\n`;
      out += `| ${Array.from({ length: width }, () => "---").join(" | ")} |\n`;
      for (const r of rows.slice(1)) {
        const c = cells(r);
        out += `| ${Array.from({ length: width }, (_, i) => c[i] ?? " ").join(" | ")} |\n`;
      }
      return out + "\n";
    }
    default: {
      // Phần tử lạ (span…): xử lý nội dung bên trong
      const t = inline(el).replace(/\u200B/g, "").trim();
      return t ? `${t}\n\n` : "";
    }
  }
}

export function htmlToMarkdown(html: string): string {
  if (typeof window === "undefined" || !html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  let out = "";
  doc.body.childNodes.forEach((c) => {
    if (c.nodeType === Node.ELEMENT_NODE) out += renderBlock(c as HTMLElement, { depth: 0 });
    else if (c.nodeType === Node.TEXT_NODE) {
      const t = (c.textContent ?? "").replace(/\u200B/g, "").trim();
      if (t) out += `${t}\n\n`;
    }
  });
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
