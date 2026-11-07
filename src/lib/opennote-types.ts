export type SortBy = "edited" | "created" | "title";
export type LayoutMode = "list" | "gallery";

export type NoteFilter =
  | { type: "all" }
  | { type: "folder"; folderId: string }
  | { type: "trash" }
  | { type: "tag"; tag: string };

export interface FolderItem {
  id: string;
  name: string;
  isSystem: boolean;
  count: number;
}

export interface TagItem {
  name: string;
  count: number;
}

export interface NoteListItem {
  id: string;
  title: string;
  snippet: string;
  pinned: boolean;
  locked: boolean;
  folderId: string;
  folderName: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetail {
  id: string;
  title: string;
  content: string;
  plainText: string;
  pinned: boolean;
  locked: boolean;
  revision: string | null;
  folderId: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
