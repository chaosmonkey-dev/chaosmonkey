/**
 * Durable Telemetry Queue — P0-G Part C
 *
 * Events leave the local queue ONLY after confirmed server acceptance.
 * The queue survives VS Code restart via globalStorageUri.
 *
 * Storage: <globalStorageUri>/pending-telemetry-v1.json
 * Atomicity: write temp → rename
 * Max size: 5000 events
 * No bearer tokens stored in the queue file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface QueuedEvent {
  event_type: string;
  count?: number;
  duration_ms?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const QUEUE_FILENAME = 'pending-telemetry-v1.json';
const MAX_QUEUE_EVENTS = 5000;

/**
 * Durable telemetry queue backed by a versioned JSON file in globalStorageUri.
 */
export class DurableTelemetryQueue {
  private queue: QueuedEvent[] = [];
  private queuePath: string;
  private loaded: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    const storageUri = context.globalStorageUri;
    const fsPath = storageUri.fsPath;

    // Ensure storage directory exists
    if (!fs.existsSync(fsPath)) {
      fs.mkdirSync(fsPath, { recursive: true });
    }

    this.queuePath = path.join(fsPath, QUEUE_FILENAME);
  }

  /**
   * Load the queue from disk. Called once during activation.
   */
  load(): void {
    if (this.loaded) {
      return;
    }

    try {
      if (fs.existsSync(this.queuePath)) {
        const data = fs.readFileSync(this.queuePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.queue = parsed.slice(0, MAX_QUEUE_EVENTS);
        }
      }
    } catch (err) {
      // Corrupt or unreadable — start with empty queue
      console.error('[CM] Failed to load durable queue:', err);
      this.queue = [];
    }

    this.loaded = true;
  }

  /**
   * Persist the queue to disk atomically (write temp → rename).
   */
  private persist(): void {
    try {
      const tmpPath = this.queuePath + '.tmp';
      const data = JSON.stringify(this.queue);
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.queuePath);
    } catch (err) {
      console.error('[CM] Failed to persist durable queue:', err);
    }
  }

  /**
   * Get the current queue length.
   */
  length(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is empty.
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get a copy of all queued events (for sending).
   */
  snapshot(): QueuedEvent[] {
    return [...this.queue];
  }

  /**
   * Add an event to the end of the queue and persist.
   */
  enqueue(event: QueuedEvent): number {
    this.queue.push(event);

    // Enforce max size — drop oldest
    if (this.queue.length > MAX_QUEUE_EVENTS) {
      const excess = this.queue.length - MAX_QUEUE_EVENTS;
      this.queue.splice(0, excess);
    }

    this.persist();
    return this.queue.length;
  }

  /**
   * Add multiple events to the end of the queue and persist.
   */
  enqueueBatch(events: QueuedEvent[]): number {
    for (const e of events) {
      this.queue.push(e);
    }

    // Enforce max size — drop oldest
    if (this.queue.length > MAX_QUEUE_EVENTS) {
      const excess = this.queue.length - MAX_QUEUE_EVENTS;
      this.queue.splice(0, excess);
    }

    this.persist();
    return this.queue.length;
  }

  /**
   * Remove exactly the accepted batch from the front of the queue and persist.
   * Called ONLY after confirmed server acceptance.
   */
  removeAccepted(count: number): void {
    if (count <= 0) {
      return;
    }
    this.queue.splice(0, Math.min(count, this.queue.length));
    this.persist();
  }

  /**
   * Prepend a failed batch back to the queue (for retry) and persist.
   */
  requeueFront(events: QueuedEvent[]): void {
    this.queue = [...events, ...this.queue];

    // Enforce max size — drop oldest
    if (this.queue.length > MAX_QUEUE_EVENTS) {
      const excess = this.queue.length - MAX_QUEUE_EVENTS;
      this.queue.splice(0, excess);
    }

    this.persist();
  }

  /**
   * Clear the entire queue and persist.
   */
  clear(): void {
    this.queue = [];
    this.persist();
  }

  /**
   * Get the raw queue array (for testing).
   */
  toArray(): QueuedEvent[] {
    return [...this.queue];
  }
}
