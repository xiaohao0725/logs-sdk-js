// 核心客户端 — 管理配置、缓冲、定时刷新和 HTTP 上报
import * as os from 'os';
import { v7 as uuidv7 } from 'uuid';
import { RingBuffer } from './buffer';
import { OfflineCache } from './offline';
import { retryWithBackoff } from './retry';
import type { LogEntry, LogSDKConfig, ResolvedConfig } from './types';

const VERSION = '0.1.0';

export class LogSDK {
  private config: ResolvedConfig;
  private buffer: RingBuffer;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private offlineCache: OfflineCache;
  private hostname: string;
  private pid: string;

  constructor(config: LogSDKConfig) {
    this.config = resolveConfig(config);
    this.offlineCache = new OfflineCache();
    this.hostname = os.hostname();
    this.pid = String(process.pid);

    // 创建环形缓冲区
    this.buffer = new RingBuffer(this.config.bufferSize, (entries) => {
      this.flushEntries(entries).catch(() => {
        // 失败在 flushEntries 内部已打日志
      });
    });

    // 启动定时 flush
    this.flushTimer = setInterval(() => {
      const entries = this.buffer.flush();
      if (entries.length > 0) {
        this.flushEntries(entries);
      }
    }, this.config.flushInterval * 1000);
  }

  /** 异步发送一条日志到缓冲区（非阻塞） */
  send(entry: LogEntry): void {
    if (this.closed) {
      console.warn('[logs-sdk] Client 已关闭，日志将被丢弃');
      return;
    }
    // 补充来源信息
    entry.host = this.hostname;
    entry.process_id = this.pid;
    entry.environment = this.config.environment;
    entry.project_slug = this.config.projectSlug;
    entry.service_name = this.config.serviceName || '';

    this.buffer.push(entry);
  }

  /** 优雅关闭，等待缓冲日志全部上报 */
  async close(): Promise<void> {
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 最终刷新
    const remaining = this.buffer.flush();
    if (remaining.length > 0) {
      try {
        await this.sendBatch(remaining);
      } catch (err) {
        console.error(`[logs-sdk] 关闭时上报失败:`, err, '— 保存到离线缓存');
        this.offlineCache.save(remaining);
      }
    }
    // 尝试重传离线缓存
    await this.flushOffline();
  }

  /** 获取 Express 中间件（动态导入，避免不安装 express 时出错） */
  expressMiddleware() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createExpressMiddleware } = require('./middleware/express');
    return createExpressMiddleware(this);
  }

  /** 获取 Koa 中间件 */
  koaMiddleware() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createKoaMiddleware } = require('./middleware/koa');
    return createKoaMiddleware(this);
  }

  // ──────────────── 内部方法 ────────────────

  /** 异步发送一批日志（包装重试） */
  private async flushEntries(entries: LogEntry[]): Promise<void> {
    try {
      await retryWithBackoff(() => this.sendBatch(entries), {
        maxRetries: this.config.maxRetries,
      });
    } catch (err) {
      console.error(`[logs-sdk] 上报失败 (数量=${entries.length}):`, err, '— 保存到离线缓存');
      this.offlineCache.save(entries);
    }
  }

  /** 重传离线缓存的日志 */
  async flushOffline(): Promise<void> {
    if (this.offlineCache.pendingCount() === 0) return;
    console.log(`[logs-sdk] 检测到 ${this.offlineCache.pendingCount()} 个离线缓存文件，开始重传...`);
    await this.offlineCache.flushAll((entries) => this.sendBatch(entries));
    console.log('[logs-sdk] 离线缓存重传完成');
  }

  /** HTTP POST 批量发送日志 */
  private async sendBatch(entries: LogEntry[]): Promise<void> {
    const body = JSON.stringify({ logs: entries });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-API-Secret': this.config.apiSecret,
          'X-SDK-Version': VERSION,
          'X-SDK-Type': 'node',
          'User-Agent': `logs-sdk-js/${VERSION}`,
        },
        body,
        signal: controller.signal,
      });

      if (resp.status !== 200 && resp.status !== 201) {
        throw new Error(`服务端返回异常状态码: ${resp.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 以下方法公开给 middleware 使用 */
  get configResolved(): ResolvedConfig {
    return this.config;
  }

  get host(): string {
    return this.hostname;
  }
}

/** 合并默认配置 */
function resolveConfig(cfg: LogSDKConfig): ResolvedConfig {
  return {
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey,
    apiSecret: cfg.apiSecret,
    projectSlug: cfg.projectSlug,
    environment: cfg.environment || 'production',
    serviceName: cfg.serviceName || '',
    bufferSize: cfg.bufferSize || 1000,
    flushInterval: cfg.flushInterval || 5,
    maxRetries: cfg.maxRetries || 3,
    maxBodySize: cfg.maxBodySize || 4096,
    maxStackSize: cfg.maxStackSize || 8192,
  };
}

/** 生成 UUID v7（32 位十六进制无连字符） */
export function newLogUUID(): string {
  return uuidv7().replaceAll('-', '');
}
