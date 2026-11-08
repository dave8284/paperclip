import { createHash } from "node:crypto";
import { PORTFOLIO_ATTACHMENT_MAX_BYTES, type PortfolioAttachmentQuery } from "@paperclipai/shared";
import { badRequest, conflict, HttpError } from "../errors.js";
import type { StorageService } from "../storage/types.js";

export interface PortfolioAttachmentSource {
  attachmentId: string; taskId: string | null; caseId?: string; assetId: string; objectKey: string; provider: string;
  contentType: string; byteSize: number; sha256: string; filename: string | null;
}
export function samePortfolioAttachment(a: PortfolioAttachmentSource, b: PortfolioAttachmentSource) {
  return a.attachmentId === b.attachmentId && a.taskId === b.taskId && a.caseId === b.caseId && a.assetId === b.assetId
    && a.provider === b.provider && a.objectKey === b.objectKey && a.contentType === b.contentType
    && a.byteSize === b.byteSize && a.sha256 === b.sha256;
}

/** At most one bounded range read, outside authorization transactions. The
 * caller reauthorizes the exact source before publishing any bytes. A chunk
 * digest is evidence about this range, not proof of the entire stored file. */
export async function readPortfolioAttachmentChunk(storage: Pick<StorageService, "provider" | "getObject">,
  source: PortfolioAttachmentSource, query: PortfolioAttachmentQuery, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  if (!Number.isSafeInteger(source.byteSize) || source.byteSize < 0 || !/^[a-f0-9]{64}$/.test(source.sha256)
    || source.provider !== storage.provider || source.sha256 !== query.sha256) throw conflict("Attachment storage or version changed; rediscover it");
  if (!Number.isSafeInteger(query.offset) || query.offset < 0 || query.offset > source.byteSize
    || (source.byteSize > 0 && query.offset === source.byteSize)
    || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > PORTFOLIO_ATTACHMENT_MAX_BYTES) throw badRequest("Invalid attachment byte range");
  const length = Math.min(query.limit, source.byteSize - query.offset);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  let object: Awaited<ReturnType<StorageService["getObject"]>> | undefined;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { object?.stream.destroy(); reject(new HttpError(503, "Attachment read was interrupted; retry if still authorized")); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const reading = (async () => {
    signal.throwIfAborted();
    const value = await storage.getObject(query.targetCompanyId, source.objectKey, {
      signal, ...(length ? { range: { start: query.offset, end: query.offset + length - 1 } } : {}),
    });
    object = value;
    if (signal.aborted) { value.stream.destroy(); signal.throwIfAborted(); }
    const chunks: Buffer[] = [];
    let actual = 0;
    try {
      if (value.contentLength !== undefined && value.contentLength !== length) throw conflict("Attachment byte range changed; rediscover it");
      for await (const chunk of value.stream) {
        const bytes = Buffer.from(chunk); actual += bytes.length;
        if (actual > length) throw conflict("Attachment storage returned an invalid byte range");
        chunks.push(bytes);
      }
      if (actual !== length) throw conflict("Attachment byte range is incomplete; retry the read");
      const body = Buffer.concat(chunks), chunkSha256 = createHash("sha256").update(body).digest("hex");
      const fullFileVerified = query.offset === 0 && actual === source.byteSize;
      if (fullFileVerified && chunkSha256 !== source.sha256) throw conflict("Attachment bytes do not match their recorded version");
      return { encoding: "base64" as const, body: body.toString("base64"), offset: query.offset,
        nextOffset: query.offset + actual < source.byteSize ? query.offset + actual : null, chunkSha256, fullFileVerified };
    } finally { value.stream.destroy(); }
  })();
  try { return await Promise.race([reading, aborted]); }
  catch (error) {
    if (error instanceof HttpError && [409, 503].includes(error.status)) throw error;
    // Storage errors can contain private object paths or provider diagnostics.
    throw new HttpError(503, "Attachment storage is unavailable; retry if still authorized");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); object?.stream.destroy(); }
}
