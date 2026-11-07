import sanitizeHtml from "sanitize-html";

const color = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d.%+\s,/-]+\))$/i;
const size = /^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/i;
const styles: Record<string, RegExp> = {
  color,
  "background-color": color,
  "font-weight": /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "font-size": size,
  "text-decoration": /^(?:(?:none|underline|line-through|overline)\s*)+$/i,
  "text-decoration-line": /^(?:(?:none|underline|line-through|overline)\s*)+$/i,
  "text-align": /^(?:left|right|center|justify|start|end)$/i,
  "vertical-align": /^(?:baseline|top|middle|bottom|sub|super)$/i,
  width: size,
  height: size,
};

function safeStyle(style: string) {
  return style.split(";").flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 0) return [];
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    return Object.hasOwn(styles, property) && styles[property].test(value)
      ? [`${property}: ${value};`]
      : [];
  }).join(" ");
}

const embeddedImage = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml|tiff|heic|heif);base64,[a-z0-9+/=\s]+$/i;

export function sanitizeNoteHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "div", "br", "span", "font", "b", "strong", "i", "em", "u", "s", "strike", "del",
      "sub", "sup", "mark", "code", "pre", "blockquote", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
      "a", "img",
    ],
    allowedAttributes: {
      "*": ["style", "class", "dir"],
      span: [{ name: "contenteditable", values: ["false"] }],
      font: ["color", "size", "face"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      ol: ["start"], li: ["value"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], col: ["span"],
    },
    allowedClasses: { "*": ["taskList", "taskItem", "taskCb", "checked", "dashed", "noteTable"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    nonTextTags: ["script", "style", "iframe", "textarea", "option", "svg", "math", "object", "template", "noscript"],
    nestingLimit: 80,
    // Filter the small set of supported CSS values before serializing. This
    // keeps the same policy in the browser without the server CSS parser.
    parseStyleAttributes: false,
    transformTags: {
      "*": (tagName, attribs) => {
        if (attribs.style) {
          const style = safeStyle(attribs.style);
          if (style) attribs.style = style;
          else delete attribs.style;
        }
        if (tagName === "img" && /^\s*data\s*:/i.test(attribs.src ?? "") && !embeddedImage.test(attribs.src)) {
          delete attribs.src;
        }
        if (tagName === "a" && attribs.target === "_blank") attribs.rel = "noopener noreferrer";
        return { tagName, attribs };
      },
    },
  });
}
