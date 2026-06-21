// 离线缓存 — 网络故障时缓存到本地文件，恢复后自动重传
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LogEntry } from './types';

export class OfflineCache {
  private dir: string;
  private maxSize: number;
  private maxAge: number;
  private enabled: boolean;

  constructor(dir?: string) {
    this.dir = dir || path.join(os.tmpdir(), 'logs-sdk-offline');
    this.maxSize = 50 * 1024 * 1024; // 50MB
    this.maxAge = 24 * 60 * 60 * 1000; // 24h
    this.enabled = true;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /** 保存一批日志到离线缓存 */
  save(entries: LogEntry[]): void {
    if (!this.enabled || entries.length === 0) return;
    this.cleanup();
    const filename = path.join(this.dir, `offline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    try {
      fs.writeFileSync(filename, JSON.stringify(entries), 'utf-8');
      console.log(`[logs-sdk] 离线缓存已保存: ${filename} (${entries.length} 条)`);
    } catch (err) {
      console.error('[logs-sdk] 离线缓存保存失败:', err);
    }
  }

  /** 读取所有离线缓存，通过回调发送，成功则删除 */
  async flushAll(sendFn: (entries: LogEntry[]) => Promise<void>): Promise<void> {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir)
        .filter(f => f.startsWith('offline-') && f.endsWith('.json'))
        .map(f => path.join(this.dir, f));
    } catch { return; }
    if (files.length === 0) return;

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs > this.maxAge) {
          fs.unlinkSync(file);
          console.log(`[logs-sdk] 过期离线缓存已删除: ${file}`);
          continue;
        }
        const data = fs.readFileSync(file, 'utf-8');
        const entries: LogEntry[] = JSON.parse(data);
        await sendFn(entries);
        fs.unlinkSync(file);
        console.log(`[logs-sdk] 离线缓存已重传: ${file} (${entries.length} 条)`);
      } catch (err) {
        console.error(`[logs-sdk] 离线缓存重传失败: ${file}`, err);
        return; // 保留文件，下次重试
      }
    }
  }

  /** 返回待重传的文件数 */
  pendingCount(): number {
    try {
      return fs.readdirSync(this.dir).filter(f => f.startsWith('offline-')).length;
    } catch { return 0; }
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  private cleanup(): void {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir).map(f => path.join(this.dir, f));
    } catch { return; }

    let totalSize = 0;
    const stats: { file: string; mtime: number; size: number }[] = [];
    for (const f of files) {
      try {
        const st = fs.statSync(f);
        totalSize += st.size;
        stats.push({ file: f, mtime: st.mtimeMs, size: st.size });
      } catch { /* skip */ }
    }

    stats.sort((a, b) => a.mtime - b.mtime);
    for (const s of stats) {
      if (totalSize <= this.maxSize) break;
      try { fs.unlinkSync(s.file); totalSize -= s.size; } catch { /* skip */ }
    }
  }
}
