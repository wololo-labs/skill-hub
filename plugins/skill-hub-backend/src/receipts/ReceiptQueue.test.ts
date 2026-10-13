import { mockServices } from '@backstage/backend-test-utils';
import { InstallReceipt, ReceiptQueue } from './ReceiptQueue';

const receipt = (n: number): InstallReceipt => ({
  actor: 'user:default/stevengonsalvez',
  entityRef: `airesource:default/skill-${n}`,
  harness: 'claude',
  commit: 'a'.repeat(40),
  verdict: 'PASS',
  copiedAt: '2026-09-06T23:00:00.000Z',
});

/**
 * Drain the microtask queue. `setImmediate` is a fake timer here, so the
 * queue's own promise chain has to be flushed with microtasks instead.
 */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('ReceiptQueue', () => {
  const logger = mockServices.logger.mock();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const queue = () =>
    new ReceiptQueue({
      logger,
      config: { baseUrl: 'https://mission-control.test/', token: 'agent-token' },
    });

  it('posts a receipt with the actor, the asset and the verdict at the time', async () => {
    const q = queue();
    q.enqueue(receipt(1));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mission-control.test/api/receipts');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer agent-token');
    expect(JSON.parse(init.body)).toMatchObject({
      kind: 'agent-asset-install',
      actor: 'user:default/stevengonsalvez',
      entityRef: 'airesource:default/skill-1',
      harness: 'claude',
      verdict: 'PASS',
    });
    q.shutdown();
  });

  it('returns while the post is still in flight, so a copy never waits on it', async () => {
    // The property that matters: enqueue returns without awaiting the
    // response. A Receipt service that hangs cannot hang a copy.
    fetchMock.mockReturnValue(new Promise(() => {}));
    const q = queue();

    const before = Date.now();
    q.enqueue(receipt(1));
    expect(Date.now() - before).toBeLessThan(50);

    await flush();
    // Still unresolved, still queued, and the caller is long gone.
    expect(q.stats()).toMatchObject({ queued: 1, delivered: 0 });
    q.shutdown();
  });

  it('never throws when Receipt service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const q = queue();
    expect(() => q.enqueue(receipt(1))).not.toThrow();
    await flush();
    expect(q.stats()).toMatchObject({ queued: 1, delivered: 0 });
    q.shutdown();
  });

  it('keeps a rejected receipt and delivers it on the retry', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const q = queue();
    q.enqueue(receipt(1));
    await flush();
    expect(q.stats()).toMatchObject({ queued: 1, delivered: 0 });

    jest.advanceTimersByTime(30_000);
    await flush();
    await flush();
    expect(q.stats()).toMatchObject({ queued: 0, delivered: 1 });
    q.shutdown();
  });

  it('drops the oldest rather than growing without bound', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const q = queue();
    for (let i = 0; i < 1005; i++) q.enqueue(receipt(i));
    await flush();

    const stats = q.stats();
    expect(stats.queued).toBeLessThanOrEqual(1000);
    expect(stats.dropped).toBeGreaterThan(0);
    q.shutdown();
  });

  it('logs the copy instead of posting when Receipt service is not configured', async () => {
    const q = new ReceiptQueue({ logger });
    q.enqueue(receipt(1));
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(q.stats()).toMatchObject({ configured: false, queued: 0 });
    q.shutdown();
  });
});
