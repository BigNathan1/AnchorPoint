import { randomUUID } from 'crypto';
import { generateStorageKey } from '../utils/storage-key';

export type UploadStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'EXPIRED_DELETED';

export interface UploadRecord {
  uploadId: string;
  account: string;
  fieldName: string;
  storageKey: string;
  contentType: string;
  expiresAt: Date;
  status: UploadStatus;
}

/**
 * Raised when the object storage provider (e.g. S3) rejects or fails an
 * operation for a reason other than "object not found" — misconfigured
 * credentials, missing bucket permissions, network failures. Callers must
 * surface it instead of treating the upload as merely absent.
 */
export class UploadStorageError extends Error {
  readonly code = 'storage_provider_error' as const;
  readonly operation: string;
  readonly originalError: unknown;

  constructor(operation: string, originalError: unknown) {
    const reason = originalError instanceof Error ? originalError.message : String(originalError);
    super(`Storage provider ${operation} failed: ${reason}`);
    this.name = 'UploadStorageError';
    this.operation = operation;
    this.originalError = originalError;
  }
}

/** True when a storage SDK error means the object does not exist (S3 NotFound / NoSuchKey / 404). */
export function isStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; Code?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NotFound' ||
    e.name === 'NoSuchKey' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404 ||
    e.statusCode === 404
  );
}

/** Lightweight in-memory store for upload records. */
const records = new Map<string, UploadRecord>();

export const uploadStore = {
  create(account: string, fieldName: string, contentType: string, expiresAt: Date): UploadRecord {
    const uploadId = randomUUID();
    const storageKey = generateStorageKey(account, fieldName, uploadId);
    const record: UploadRecord = { uploadId, account, fieldName, storageKey, contentType, expiresAt, status: 'PENDING' };
    records.set(uploadId, record);
    return record;
  },

  get(uploadId: string): UploadRecord | undefined {
    return records.get(uploadId);
  },

  setStatus(uploadId: string, status: UploadStatus): void {
    const r = records.get(uploadId);
    if (r) r.status = status;
  },

  setStorageKey(uploadId: string, storageKey: string): void {
    const r = records.get(uploadId);
    if (r) r.storageKey = storageKey;
  },

  /** Discard a record, e.g. when the storage provider could not issue its upload URL. */
  remove(uploadId: string): void {
    records.delete(uploadId);
  },

  /** Test helper: clear all in-memory records. */
  _reset(): void {
    records.clear();
  },

  expireStale(): number {
    const now = new Date();
    let count = 0;
    for (const r of records.values()) {
      if (r.status === 'PENDING' && r.expiresAt < now) {
        r.status = 'EXPIRED';
        count++;
      }
    }
    return count;
  },
};
