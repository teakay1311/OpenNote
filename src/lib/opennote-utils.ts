import { format, isToday, isYesterday, isThisYear } from "date-fns";
import { vi } from "date-fns/locale";

/** Apple Notes style relative date */
export function formatNoteDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return format(d, "HH:mm", { locale: vi });
  if (isYesterday(d)) return `Hôm qua ${format(d, "HH:mm", { locale: vi })}`;
  if (isThisYear(d)) return format(d, "dd MMMM", { locale: vi });
  return format(d, "dd/MM/yyyy", { locale: vi });
}

/** Long format for note header & info panel */
export function formatNoteDateLong(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "HH:mm, d MMMM yyyy", { locale: vi });
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export { extractTags as extractTagsClient } from "./note-tags";

export const TAG_COLORS = [
  "bg-amber-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-fuchsia-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-lime-600",
];

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/** Derive a display title from note title or content */
export function displayTitle(title: string, plainText: string): string {
  if (title.trim()) return title.trim();
  const first = plainText.split("\n").map((l) => l.trim()).find(Boolean);
  return first ? first.slice(0, 80) : "";
}
