export interface PendingImportInput {
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
  source: 'share-target' | 'picker' | 'android-view';
  deliveryKey?: string;
}

export function putPendingImport(file: PendingImportInput): Promise<{ id: string; duplicate: boolean }>;
export function purgeExpiredImports(): Promise<void>;
