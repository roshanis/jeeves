/**
 * Capped request-body reader for `app/api/**` route handlers. Next applies no
 * body limit to route handlers, so `req.json()` buffers whatever a client
 * sends. These helpers count bytes as they stream and stop at the cap.
 */
/** Default cap for a signed-in mutation: far above any legitimate chat or draft body. */
export const DEFAULT_BODY_MAX_BYTES = 1024 * 1024;
/** Cap for a route that must read a body before any session exists. */
export const PRE_SESSION_BODY_MAX_BYTES = 16 * 1024;

export class BodyReadError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "BodyReadError";
  }
}

/** Read the body as UTF-8 text; throws BodyReadError(413) once it exceeds `maxBytes`. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > maxBytes) throw new BodyReadError(413, "request body is too large");
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyReadError(413, "request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Read and parse a JSON body under a byte cap. Too large -> 413. Empty or
 * malformed -> 400 "invalid JSON body", or `{}` when `optional` is set.
 */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
  options: { optional?: boolean } = {},
): Promise<unknown> {
  const text = await readBodyText(req, maxBytes);
  try {
    if (text.trim() === "") throw new Error("empty");
    return JSON.parse(text);
  } catch {
    if (options.optional) return {};
    throw new BodyReadError(400, "invalid JSON body");
  }
}
