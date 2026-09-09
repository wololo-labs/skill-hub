import { LoggerService } from '@backstage/backend-plugin-api';

export interface InstallReceipt {
  /** Who copied the command. */
  actor: string;
  /** Which asset, as an entity reference. */
  entityRef: string;
  /** Which harness the command targeted. */
  harness: string;
  /** The commit the asset was pinned to at the moment of the copy. */
  commit?: string;
  /** The verdict at the moment of the copy, if the asset was scored. */
  verdict?: string;
  copiedAt: string;
}

export interface MissionControlConfig {
  baseUrl: string;
  token: string;
}

const MAX_QUEUE = 1000;
const RETRY_MS = 30_000;

/**
 * Records install receipts, without ever getting in the way of a copy.
 *
 * `enqueue` returns synchronously. A receipt that cannot be delivered stays in
 * a bounded local queue and is retried in the background, so an unreachable or
 * slow Mission Control costs the developer nothing. Receipts are held in
 * memory: a restart loses undelivered ones, which is the accepted trade for
 * never coupling the copy to a second service.
 */
export class ReceiptQueue {
  readonly #logger: LoggerService;
  readonly #config?: MissionControlConfig;
  readonly #queue: InstallReceipt[] = [];
  #timer?: ReturnType<typeof setTimeout>;
  #draining = false;
  #delivered = 0;
  #dropped = 0;

  constructor(options: {
    logger: LoggerService;
    config?: MissionControlConfig;
  }) {
    this.#logger = options.logger;
    this.#config = options.config;
  }

  enqueue(receipt: InstallReceipt): void {
    if (!this.#config) {
      this.#logger.info(
        `install receipt (not posted, Mission Control is not configured): ${receipt.actor} copied ${receipt.entityRef} for ${receipt.harness}`,
      );
      return;
    }
    if (this.#queue.length >= MAX_QUEUE) {
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(receipt);
    void this.#drain();
  }

  stats() {
    return {
      configured: Boolean(this.#config),
      queued: this.#queue.length,
      delivered: this.#delivered,
      dropped: this.#dropped,
    };
  }

  /** Stops the retry timer, so the process can exit cleanly. */
  shutdown(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #drain(): Promise<void> {
    if (this.#draining || !this.#config) return;
    this.#draining = true;
    try {
      while (this.#queue.length) {
        const receipt = this.#queue[0];
        const ok = await this.#post(receipt);
        if (!ok) {
          this.#scheduleRetry();
          return;
        }
        this.#queue.shift();
        this.#delivered += 1;
      }
    } finally {
      this.#draining = false;
    }
  }

  #scheduleRetry(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#drain();
    }, RETRY_MS);
    // A retry timer must never hold the process open.
    this.#timer.unref?.();
  }

  async #post(receipt: InstallReceipt): Promise<boolean> {
    const { baseUrl, token } = this.#config!;
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/api/receipts`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ kind: 'agent-asset-install', ...receipt }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        this.#logger.warn(
          `Mission Control rejected a receipt with ${response.status}, will retry`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.#logger.warn(
        `could not post a receipt to Mission Control, will retry: ${
          (error as Error).message
        }`,
      );
      return false;
    }
  }
}
