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

export function createActivityStore({
  archivePath,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS,
  maxArchiveQueueEvents = DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS,
}: ActivityStoreOptions = {}): ActivityStore {
  return new ActivityStore({
    archivePath,
    flushIntervalMs,
    maxMemoryEvents,
    maxArchiveQueueEvents,
  });
}

export class ActivityStore {
  archivePath?: string;
  private readonly maxMemoryEvents: number;
  private readonly maxArchiveQueueEvents: number;
  private events: StoredActivityEvent[];
  private pending: StoredActivityEvent[];
  private writeQueue: Promise<void>;
  private clearGeneration: number;
  private closed: boolean;
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
    this.events = [];
    this.pending = [];
    this.writeQueue = Promise.resolve();
    this.clearGeneration = 0;
    this.closed = false;
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
    return { events: copyArray(this.events) };
  }

  async flush(): Promise<void> {
    if (!this.archivePath || this.pending.length === 0) return;
    const batch = this.pending;
    const clearGeneration = this.clearGeneration;
    this.pending = [];
    this.writeQueue = this.writeQueue
      .catch((error) => {
        console.warn(`warning: activity-archive-queue-recovered error=${error.message}`);
      })
      .then(async () => {
        await appendActivityEvents(this.archivePath, batch);
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
    if (this.pending.length === 0) {
      this.pending = batch;
      return;
    }

    const pending = new Array(batch.length + this.pending.length);
    let index = 0;
    for (const event of batch) {
      pending[index] = event;
      index += 1;
    }
    for (const event of this.pending) {
      pending[index] = event;
      index += 1;
    }
    this.pending = pending;
  }
}

function trimOldest(events: StoredActivityEvent[], maxEvents: number): void {
  if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
}

function copyArray(values: StoredActivityEvent[]): StoredActivityEvent[] {
  const copy = new Array<StoredActivityEvent>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined) copy[index] = value;
  }
  return copy;
}

export async function appendActivityEvents(archivePath: string, events: StoredActivityEvent[]): Promise<void> {
  if (!events.length) return;
  await mkdir(dirname(archivePath), { recursive: true });
  const lines = new Array(events.length);
  for (let index = 0; index < events.length; index += 1) {
    lines[index] = JSON.stringify(events[index]);
  }
  await appendFile(archivePath, `${lines.join("\n")}\n`);
}

export async function ensureActivityArchive(archivePath: string): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  await appendFile(archivePath, "");
}

export async function clearActivityArchive(archivePath: string): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, "");
}
