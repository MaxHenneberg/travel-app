export interface ImportLimits {
  maxFileBytes: number;
  maxNestingDepth: number;
  maxItemCount: number;
  maxParseMilliseconds: number;
}

export const TRAILBOOK_IMPORT_LIMITS: Readonly<ImportLimits>;
export function validateImportTransport(file: File, options?: { source?: 'share-target' | 'picker'; limits?: ImportLimits }): { displayName: string; kind: string };
