const HASHTAG = /#[\p{L}\p{N}\p{M}_]+/gu;

export function tagKey(value: string) {
  return value.normalize("NFC").toLowerCase();
}

export function normalizeTag(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^#+/, "").normalize("NFC");
  return /^[\p{L}\p{N}\p{M}_]{1,50}$/u.test(name) ? name : null;
}

export function tagMatches(text: string) {
  return text.matchAll(HASHTAG);
}

export function extractTags(text: string) {
  const tags = new Map<string, string>();
  for (const [tag] of tagMatches(text)) tags.set(tagKey(tag), tag.normalize("NFC"));
  return [...tags.values()];
}

export function replaceTag(text: string, from: string, to: string | null) {
  return text.replace(HASHTAG, (tag) =>
    tagKey(tag) === from ? (to ? `#${to}` : "") : tag
  );
}
