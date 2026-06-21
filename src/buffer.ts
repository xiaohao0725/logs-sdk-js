// 环形缓冲区 — 暂存待上报日志，满 80% 自动触发 flush
import type { LogEntry } from './types';

export type FlushCallback = (entries: LogEntry[]) => void;

export class RingBuffer {
  private buf: (LogEntry | null)[];
  private capacity: number;
  private head = 0;
  private tail = 0;
  private count = 0;
  private flushFn: FlushCallback;

  constructor(capacity: number, flushFn: FlushCallback) {
    this.capacity = Math.max(capacity, 100);
    this.buf = new Array(this.capacity).fill(null);
    this.flushFn = flushFn;
  }

  /** 追加一条日志到缓冲区 */
  push(entry: LogEntry): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    this.count++;

    // 缓冲使用率达 80% 自动触发 flush
    if (this.count >= Math.floor(this.capacity * 0.8)) {
      const entries = this.drain();
      this.flushFn(entries);
    }
  }

  /** 取出所有待上报日志并清空缓冲 */
  flush(): LogEntry[] {
    return this.drain();
  }

  get length(): number {
    return this.count;
  }

  /** 内部排空方法 */
  private drain(): LogEntry[] {
    const entries: LogEntry[] = [];
    while (this.count > 0) {
      const entry = this.buf[this.tail];
      if (entry) {
        entries.push(entry);
      }
      this.buf[this.tail] = null; // 帮助 GC
      this.tail = (this.tail + 1) % this.capacity;
      this.count--;
    }
    return entries;
  }
}
