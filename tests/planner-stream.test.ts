import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerResultStream, readPlannerResultStream } from '../lib/planner-result-stream';
import type { PlannerResult } from '../lib/auto-planner';
import { PriorityQueue } from '../lib/priority-queue';

const partial = { plans: [{ key: 'valid' }], examined: 7, limited: true } as PlannerResult;
test('streams usable suggestions before search completion and retains them on cancellation', async () => {
  const cancel = new AbortController();
  const stream = plannerResultStream(async (signal, publish) => {
    publish(partial);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return partial;
  }, cancel.signal, 1000);
  const counts: number[] = [];
  const result = await readPlannerResultStream(new Response(stream), progress => {
    counts.push(progress.plans.length);
    if (progress.plans.length) cancel.abort();
  });
  assert(counts.includes(1));
  assert.deepEqual(result.plans, partial.plans);
});

test('stream deadline delivers partial results without waiting for unfinished work', async () => {
  let stopped = false;
  const stream = plannerResultStream(async (signal, publish) => {
    signal.addEventListener('abort', () => { stopped = true; });
    publish(partial);
    return new Promise<PlannerResult>(() => {});
  }, new AbortController().signal, 20);
  const result = await readPlannerResultStream(new Response(stream), () => {});
  assert.equal(result.stopReason, 'timeout');
  assert(stopped);
  assert.deepEqual(result.plans, partial.plans);
});

test('closing the stream stops its search', async () => {
  let signal: AbortSignal | undefined;
  const stream = plannerResultStream(async current => {
    signal = current;
    return new Promise<PlannerResult>(() => {});
  }, new AbortController().signal, 1000);
  await stream.cancel();
  assert(signal?.aborted);
});

test('priority queue preserves stable search ordering across interleaved insertions', () => {
  const queue = new PriorityQueue<{ rank: number; index: number }>((a, b) => a.rank - b.rank);
  const items = Array.from({ length: 1000 }, (_, index) => ({ rank: index * 97 % 31, index }));
  items.forEach(item => queue.push(item));
  const expected = [...items].sort((a, b) => a.rank - b.rank);
  for (const item of expected) assert.deepEqual(queue.shift(), item);
  assert.equal(queue.shift(), undefined);
  queue.push({ rank: 1, index: 1000 });
  assert.equal(queue.shift()?.index, 1000);
});
