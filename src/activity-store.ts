import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_MEMORY_EVENTS = 2000;
const DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS = 2000;

export type StoredActivityEvent = {
  id?: string;
  [key: string]: unknown;
};

export type ActivityStoreOptions = {
  archivePath?: string;
  flushIntervalMs?: number;
  maxMemoryEvents?: number;
  maxArchiveQueueEvents?: number;
};

export type ActivitySnapshot = {
  events: StoredActivityEvent[];
};

export function createActivityStore(options: ActivityStoreOptions = {}): ActivityStore {
  return new ActivityStore(options);
}

export class ActivityStore {
  archivePath: string | undefined;
  private readonly maxMemoryEvents: number;
  private readonly maxArchiveQueueEvents: number;
  private events: StoredActivityEvent[] = [];
  private pending: StoredActivityEvent[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private clearGeneration = 0;
  private closed = false;
  private readonly timer: NodeJS.Timeout;

  constructor({
    archivePath,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS,
    maxArchiveQueueEvents = DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS,
  }: ActivityStoreOptions = {}) {
    this.archivePath = archivePath;
    this.maxMemoryEvents = maxMemoryEvents;
    this.maxArchiveQueueEvents = maxArchiveQueueEvents;
    this.timer = setInterval(() => {
      this.flush().catch((error) => {
        console.warn(`warning: activity-archive-flush-skipped error=${error.message}`);
      });
    }, flushIntervalMs);
    this.timer.unref?.();
  }

  add(event: StoredActivityEvent): StoredActivityEvent {
    this.events.push(event);
    this.pending.push(event);
    trimOldest(this.events, this.maxMemoryEvents);
    this.trimPending();
    return event;
  }

  snapshot(): ActivitySnapshot {
    return { events: this.events.slice() };
  }

  async flush(): Promise<void> {
    if (!this.archivePath || this.pending.length === 0) return;
    const archivePath = this.archivePath;
    const batch = this.pending;
    const clearGeneration = this.clearGeneration;
    this.pending = [];
    this.writeQueue = this.writeQueue
      .catch((error) => {
        console.warn(`warning: activity-archive-queue-recovered error=${error.message}`);
      })
      .then(async () => {
        await appendActivityEvents(archivePath, batch);
      })
      .catch((error) => {
        if (clearGeneration === this.clearGeneration) {
          this.restorePendingBatch(batch);
          this.trimPending();
        }
        throw error;
      });

    return this.writeQueue;
  }

  async clear(): Promise<void> {
    this.clearGeneration += 1;
    this.events.length = 0;
    this.pending.length = 0;
    this.writeQueue = this.writeQueue
      .catch((error) => {
        console.warn(`warning: activity-archive-queue-recovered error=${error.message}`);
      })
      .then(async () => {
        if (this.archivePath) await clearActivityArchive(this.archivePath);
      });
    return this.writeQueue;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
    await this.writeQueue;
  }

  trimPending(): void {
    trimOldest(this.pending, this.maxArchiveQueueEvents);
  }

  restorePendingBatch(batch: StoredActivityEvent[]): void {
    this.pending = [...batch, ...this.pending];
  }
}

function trimOldest(events: StoredActivityEvent[], maxEvents: number): void {
  if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
}

export async function appendActivityEvents(archivePath: string, events: StoredActivityEvent[]): Promise<void> {
  if (!events.length) return;
  await mkdir(dirname(archivePath), { recursive: true });
  await appendFile(archivePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

export async function ensureActivityArchive(archivePath: string): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  await appendFile(archivePath, "");
}

export async function clearActivityArchive(archivePath: string): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, "");
}
