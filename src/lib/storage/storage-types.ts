export interface StoredObjectHead {
  size: number | null;
  etag: string | null;
  contentType: string | null;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  copyIfMatch(sourceKey: string, destinationKey: string, expectedEtag: string): Promise<void>;
  head(key: string): Promise<StoredObjectHead | null>;
  delete(key: string): Promise<void>;
  signedGetUrl(key: string, expiresSeconds?: number): Promise<string>;
  signedPutUrl(key: string, contentType: string, expiresSeconds?: number): Promise<string>;
}
