import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_MEMORY_EVENTS = 2000;

export function createActivityStore({
  archivePath,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS,
} = {}) {
  const events = [];
  const pending = [];
  let writeQueue = Promise.resolve();
  let closed = false;

  const timer = setInterval(() => {
    flush().catch((error) => {
      console.warn(`Activity archive flush skipped: ${error.message}`);
    });
  }, flushIntervalMs);
  timer.unref?.();

  function add(event) {
    events.push(event);
    pending.push(event);
    while (events.length > maxMemoryEvents) events.shift();
    return event;
  }

  function snapshot() {
    return { events: [...events] };
  }

  async function flush() {
    if (!archivePath || pending.length === 0) return;
    const batch = pending.splice(0);
    writeQueue = writeQueue
      .catch((error) => {
        console.warn(`Activity archive queue recovered: ${error.message}`);
      })
      .then(async () => {
        await appendActivityEvents(archivePath, batch);
      })
      .catch((error) => {
        pending.unshift(...batch);
        throw error;
      });

    return writeQueue;
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await flush();
    await writeQueue;
  }

  return {
    add,
    snapshot,
    flush,
    close,
  };
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
