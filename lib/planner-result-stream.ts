import type { PlannerResult } from './auto-planner';

export function plannerResultStream(
  run: (signal: AbortSignal, publish: (result: PlannerResult) => void) => Promise<PlannerResult>,
  parentSignal: AbortSignal,
  timeoutMs: number,
) {
  const abort = new AbortController();
  let latest: PlannerResult = { plans: [], examined: 0, limited: true };
  let closed = false;
  let deadlineTimer: ReturnType<typeof setTimeout>;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = 0;
  const encoder = new TextEncoder();
  const cleanup = () => {
    clearTimeout(deadlineTimer); clearTimeout(flushTimer);
    parentSignal.removeEventListener('abort', disconnect);
  };
  const disconnect = () => { abort.abort(); };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (type: string, result: PlannerResult) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify({ type, result }) + '\n'));
      };
      const finish = (result: PlannerResult) => {
        if (closed) return;
        send('result', result); closed = true; cleanup(); controller.close();
      };
      parentSignal.addEventListener('abort', disconnect, { once: true });
      if (parentSignal.aborted) abort.abort();
      deadlineTimer = setTimeout(() => {
        abort.abort();
        finish({ ...latest, limited: true, stopReason: 'timeout' });
      }, timeoutMs);
      send('progress', latest);
      void run(abort.signal, result => {
        if (closed || abort.signal.aborted) return;
        latest = result;
        const flush = () => { flushTimer = undefined; lastSent = Date.now(); send('progress', latest); };
        if (Date.now() - lastSent >= 250) { clearTimeout(flushTimer); flush(); }
        else if (!flushTimer) flushTimer = setTimeout(flush, 250);
      }).then(finish).catch(error => {
        if (closed) return;
        if (abort.signal.aborted) { finish({ ...latest, limited: true }); return; }
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Search failed.' }) + '\n'));
        closed = true; cleanup(); controller.close();
      });
    },
    cancel() { closed = true; cleanup(); abort.abort(); },
  });
}

export async function readPlannerResultStream(response: Response, onProgress: (result: PlannerResult) => void) {
  if (!response.body) throw new Error('Search response is empty.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: PlannerResult | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'progress') onProgress(event.result);
        if (event.type === 'result') { final = event.result; onProgress(event.result); }
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  if (!final) throw new Error('Search connection ended before completion.');
  return final;
}
