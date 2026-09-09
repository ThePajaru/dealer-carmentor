// Shared consumer for the `/api/analyze` (and dealer proxy) SSE stream.
//
// The analysis runs 12–36s and the route emits `data: {...}` lines for
// `progress`, then a final `complete` with the `analysis_id`, then closes.
// Two things have bitten us before (see CLAUDE.md "SSE chunk boundaries"):
//   1. A ReadableStream chunk can split a `data: {...}` line across two reads,
//      so we buffer the trailing partial line and only parse complete lines.
//   2. The final `complete` event can arrive in that trailing buffer with no
//      newline after it, so we flush the buffer once the stream ends.
// Codifying it here once means every call site (consumer /analizar, dealer
// case page, dealer Analizar workbench) gets the correct, tested behavior.

export interface ConsumeAnalyzeStreamOptions {
  /** Called with each `progress` message so the caller can update its UI. */
  onProgress?: (message: string) => void;
}

/** Ignore JSON.parse noise from an incomplete tail line; re-throw anything real. */
function isBenignParseError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Unexpected end of JSON input';
}

/** Dispatch one already-sliced `data:` payload. Returns the analysis_id if this was the `complete` event. */
function handlePayload(raw: string, onProgress?: (m: string) => void): string | null {
  const payload = JSON.parse(raw);
  if (payload.type === 'progress') onProgress?.(payload.message || 'Analizando...');
  if (payload.type === 'error') throw new Error(payload.message || 'Error durante el análisis');
  if (payload.type === 'complete') return payload.analysis_id ?? null;
  return null;
}

/**
 * Drain the analyze SSE stream to completion.
 * @returns the `analysis_id` from the `complete` event, or `null` if the stream
 *          closed without one (the caller decides whether that's an error).
 * @throws if the stream has no readable body or emits an `error` event.
 */
export async function consumeAnalyzeStream(
  response: Response,
  opts: ConsumeAnalyzeStreamOptions = {},
): Promise<string | null> {
  // Dedupe (200 `duplicate`) and in-progress (202) short-circuits answer with
  // plain JSON instead of SSE. Without this, callers read zero `data:` lines,
  // get null and surface a false "no devolvió resultado" error.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null);
    if (data?.error) throw new Error(data.error);
    return data?.analysis_id ?? null;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer la respuesta');

  const decoder = new TextDecoder();
  let analysisId: string | null = null;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer.
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const id = handlePayload(line.slice(6), opts.onProgress);
        if (id) analysisId = id;
      } catch (err) {
        if (!isBenignParseError(err)) throw err;
      }
    }
  }

  // Flush a `complete`/`error` that arrived in the trailing buffer with no newline.
  const tail = buffer.trim();
  if (tail.startsWith('data: ')) {
    try {
      const id = handlePayload(tail.slice(6), opts.onProgress);
      if (id) analysisId = id;
    } catch (err) {
      if (!isBenignParseError(err)) throw err;
    }
  }

  return analysisId;
}
