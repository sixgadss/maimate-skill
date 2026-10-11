import { randomUUID } from 'node:crypto';
export class UndoStore<T> {
  private entries = new Map<string, { value: T; version: number; validUntil: string }>();
  constructor(private clock: () => string) {}
  put(value: T, version: number) {
    this.purge(); const ref = randomUUID(), validUntil = new Date(Date.parse(this.clock()) + 300_000).toISOString();
    this.entries.set(ref, { value: structuredClone(value), version, validUntil }); return { ref, validUntil };
  }
  take(ref: string, version: number): T {
    this.purge(); const entry = this.entries.get(ref);
    if (!entry || entry.version !== version) throw new Error('Undo is expired or conflicts with newer memory');
    this.entries.delete(ref); return entry.value;
  }
  clear() { this.entries.clear(); }
  private purge() { for (const [key, entry] of this.entries) if (Date.parse(entry.validUntil) <= Date.parse(this.clock())) this.entries.delete(key); }
}
