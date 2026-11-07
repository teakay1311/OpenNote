import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeNoteHtml } from "../src/lib/note-html";
import { htmlToPlainText, replaceHtmlTag } from "../src/lib/note-html-text";
import { extractTags, normalizeTag, replaceTag } from "../src/lib/note-tags";

describe("OpenNote rich content", () => {
  test("removes executable markup and preserves supported formatting and images", () => {
    const html = sanitizeNoteHtml(
      '<script>alert(1)</script><iframe srcdoc="<img onerror=alert(1)>"></iframe>' +
      '<a href="java&#x09;script:alert(1)">link</a>' +
      '<img src="data:image/png;base64,AAAA" onerror="alert(1)">' +
      '<span style="font-weight:bold;color:rgb(1,2,3);background-image:url(x)">Styled</span>' +
      '<ul class="taskList"><li class="taskItem checked"><span class="taskCb" contenteditable="false"></span>Task</li></ul>'
    );
    assert.doesNotMatch(html, /alert\(|onerror|javascript|iframe|background-image/);
    assert.match(html, /data:image\/png;base64,AAAA/);
    assert.match(html, /font-weight: bold;/);
    assert.match(html, /color: rgb\(1,2,3\);/);
    assert.match(html, /class="taskItem checked"/);
    assert.match(html, /contenteditable="false"/);
    assert.equal(sanitizeNoteHtml(html), html);
  });

  test("matches Vietnamese Unicode and rewrites text across formatting without changing attributes", () => {
    const decomposed = "thẻ".normalize("NFD");
    const html = `<p><a href="https://example.test/#thẻ">#<b>${decomposed}</b>]</a> #thẻ_dài</p>`;
    assert.equal(normalizeTag(decomposed), "thẻ");
    assert.deepEqual(extractTags(htmlToPlainText(html)), ["#thẻ", "#thẻ_dài"]);
    const renamed = replaceHtmlTag(html, "#thẻ", "mới");
    assert.match(renamed, /href="https:\/\/example.test\/#thẻ"/);
    assert.equal(htmlToPlainText(renamed), "#mới] #thẻ_dài");
    assert.equal(replaceTag("#thẻ] #thẻ_dài", "#thẻ", null), "] #thẻ_dài");
  });
});
