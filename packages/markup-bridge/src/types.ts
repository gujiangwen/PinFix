/** Compatible markup workspace session (MarkUp-style file pair). */

export type AnnotationSessionMeta = {
  /** File stem without `_annotations.md` / `.png`, e.g. `2026-11-17_button-color`. */
  id: string;
  slug: string;
  created_at: string;
  page_url?: string;
  selector?: string;
  note?: string;
  md_path: string;
  png_path: string | null;
};

export type AnnotationSessionDetail = AnnotationSessionMeta & {
  markdown: string;
};

export type WriteAnnotationInput = {
  workspaceDir: string;
  slug: string;
  pageUrl: string;
  note?: string;
  selector?: string;
  sniff?: unknown;
  /** Optional PNG bytes; when omitted only markdown is written. */
  png?: Uint8Array | null;
  /** ISO date prefix; default today UTC. */
  date?: string;
};

export type MarkupTools = {
  listAnnotationSessions(): Promise<AnnotationSessionMeta[]>;
  getLatestAnnotations(): Promise<AnnotationSessionDetail | null>;
  getAnnotationSession(id: string): Promise<AnnotationSessionDetail | null>;
};

export type MarkupAdapterKind = "self" | "official";
