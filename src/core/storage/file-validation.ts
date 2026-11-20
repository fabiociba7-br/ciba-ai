import type { GarciaFileCreateInput } from "./file-types";

export const ID = /^[A-Za-z0-9._:-]{1,200}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
export const isSafeStorageText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
export const isValidStorageDate = (value: string) => Number.isFinite(Date.parse(value));

export function validateGarciaFileInput(input: GarciaFileCreateInput): void {
  if (!input || !ID.test(input.id) || !isSafeStorageText(input.namespace, 120) ||
      !(input.ownerId == null || isSafeStorageText(input.ownerId, 200)) ||
      !(input.appId == null || isSafeStorageText(input.appId, 200)) ||
      !isSafeStorageText(input.objectKey, 1_024) || input.objectKey.startsWith("/") ||
      input.objectKey.split("/").some((part) => part === "..") ||
      !isSafeStorageText(input.filename, 255) || !MIME.test(input.mimeType) ||
      !Number.isSafeInteger(input.byteSize) || input.byteSize < 0 ||
      !HASH.test(input.sha256) || !isSafeStorageText(input.bucketName, 100) ||
      !(input.source === undefined || isSafeStorageText(input.source, 80)) ||
      !(input.now === undefined || isValidStorageDate(input.now))) {
    throw new Error("invalid_garcia_file_metadata");
  }
}


export const isValidStorageId = (value: string) => ID.test(value);
export const isValidStorageMime = (value: string) => MIME.test(value);
export const isValidStorageHash = (value: string) => HASH.test(value);
