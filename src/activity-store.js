import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_MEMORY_EVENTS = 2000;
const DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS = 2000;

export function createActivityStore({
  archivePath,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS,
  maxArchiveQueueEvents = DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS,
} = {}) {
  return new ActivityStore({
    archivePath,
    flushIntervalMs,
    maxMemoryEvents,
    maxArchiveQueueEvents,
  });
}

export class ActivityStore {
  constructor({
    archivePath,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS,
    maxArchiveQueueEvents = DEFAULT_MAX_ARCHIVE_QUEUE_EVENTS,
  } = {}) {
    this.archivePath = archivePath;
    this.maxMemoryEvents = maxMemoryEvents;
    this.maxArchiveQueueEvents = maxArchiveQueueEvents;
    this.events = [];
    this.pending = [];
    this.writeQueue = Promise.resolve();
    this.closed = false;
    this.timer = setInterval(() => {
      this.flush().catch((error) => {
        console.warn(`warning: activity-archive-flush-skipped error=${error.message}`);
      });
    }, flushIntervalMs);
    this.timer.unref?.();
  }

  add(event) {
    this.events.push(event);
    this.pending.push(event);
    while (this.events.length > this.maxMemoryEvents) this.events.shift();
    this.trimPending();
    return event;
  }

  snapshot() {
    return { events: [...this.events] };
  }

  async flush() {
    if (!this.archivePath || this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    this.writeQueue = this.writeQueue
      .catch((error) => {
        console.warn(`warning: activity-archive-queue-recovered error=${error.message}`);
      })
      .then(async () => {
        await appendActivityEvents(this.archivePath, batch);
      })
      .catch((error) => {
        this.pending.unshift(...batch);
        this.trimPending();
        throw error;
      });

    return this.writeQueue;
  }

  async clear() {
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

  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    await this.flush();
    await this.writeQueue;
  }

  trimPending() {
    while (this.pending.length > this.maxArchiveQueueEvents) this.pending.shift();
  }
}

export async function appendActivityEvents(archivePath, events) {
  if (!events.length) return;
  await mkdir(dirname(archivePath), { recursive: true });
  await appendFile(archivePath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

export async function ensureActivityArchive(archivePath) {
  await mkdir(dirname(archivePath), { recursive: true });
  await appendFile(archivePath, "");
}

export async function clearActivityArchive(archivePath) {
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, "");
}
