import { useOpenNoteStore } from "@/store/opennote-store";
import type { NoteDetail } from "./opennote-types";

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null) {
    throw new RequestError(data?.error || "Không nhận được kết quả từ máy chủ", res.status);
  }
  return data as T;
}

export function noteHeaders(id: string) {
  const token = useOpenNoteStore.getState().noteAccess[id];
  return token ? { "x-opennote-access": token } : undefined;
}

export function fetchNote(id: string) {
  return jsonFetch<NoteDetail>(`/api/notes/${id}`, { headers: noteHeaders(id), cache: "no-store" });
}
