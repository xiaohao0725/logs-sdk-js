// Express 中间件 — 自动采集所有 HTTP 请求日志
import type { Request, Response, NextFunction } from 'express';
import type { LogSDK } from '../client';
import { newLogUUID } from '../client';
import type { LogEntry, ClientType } from '../types';

/**
 * 创建 Express 日志采集中间件。
 * 自动采集：请求头/体、响应头/体、客户端信息、错误堆栈、耗时统计。
 */
export function createExpressMiddleware(sdk: LogSDK) {
  const config = sdk.configResolved;

  return (req: Request, res: Response, next: NextFunction) => {
    const entryUUID = newLogUUID();
    const startTime = Date.now();
    const startHrTime = process.hrtime.bigint();

    // 读取请求体
    const reqBody = captureRequestBody(req, config.maxBodySize);

    // 包装 res.end 以捕获响应体
    const origEnd = res.end;
    const origWrite = res.write;
    const chunks: Buffer[] = [];

    res.write = ((chunk: any, encoding: any, callback: any) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return origWrite.call(res, chunk, encoding, callback);
    }) as any;

    res.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const respBody = Buffer.concat(chunks).toString('utf-8');
      const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
      const entry = buildExpressEntry(req, res, entryUUID, startTime, durationMs, reqBody, respBody, config, sdk.host);

      entry.tls_version = (req.connection as any)?.getTlsinfo?.()?.protocol || "";
      entry.tls_cipher = (req.connection as any)?.getTlsinfo?.()?.cipher?.name || "";
      entry.proto = String(req.httpVersion);
      entry.api_version = extractAPIVersion(req.path);
      entry.referer = (req.get("referer") as string) || "";
      entry.request_id = entryUUID.slice(0, 8);

      if (res.statusCode >= 400) {
        entry.is_error = true;
        entry.error_type = 'http_error';
        entry.error_message = entry.response_body;
      }

      sdk.send(entry);
      return origEnd.call(res, chunk, encoding, callback);
    }) as any;

    try {
      next();
    } catch (err: any) {
      const entry = buildExpressEntry(req, res, entryUUID, startTime, 0, reqBody, '', config, sdk.host);
      entry.is_error = true;
      entry.error_type = 'panic';
      entry.error_message = err?.message || String(err);
      entry.error_stack = err?.stack || '';
      sdk.send(entry);
      throw err;
    }
  };
}

/** 从 Express Request 构建 LogEntry */
function buildExpressEntry(
  req: Request,
  res: Response,
  uuid: string,
  startTime: number,
  durationMs: number,
  reqBody: string,
  respBody: string,
  config: any,
  host: string,
): LogEntry {
  const scheme = req.protocol || (req.secure ? 'https' : 'http');
  const fullURL = `${scheme}://${req.hostname || req.get('host')}${req.originalUrl}`;

  return {
    uuid,
    timestamp: new Date(startTime).toISOString(),
    duration_ms: Math.round(durationMs),
    method: req.method,
    scheme,
    full_url: fullURL,
    host_header: req.get('host') || '',
    path: req.path,
    query_string: Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '',
    origin: detectOrigin(req),
    request_headers: sanitizeHeaders(req.headers),
    request_body: truncate(reqBody, config.maxBodySize),
    request_body_size: Buffer.byteLength(reqBody),
    content_type: req.get('content-type') || '',
    status_code: res.statusCode,
    response_headers: sanitizeHeaders(res.getHeaders()),
    response_body: truncate(respBody, config.maxBodySize),
    response_body_size: Buffer.byteLength(respBody),
    client_ip: realClientIP(req),
    client_ip_chain: (req.get('x-forwarded-for') as string) || '',
    client_type: detectClientType(req),
    client_port: 0,
    user_agent: req.get('user-agent') || '',
    is_error: false,
    error_message: '',
    error_type: '',
    error_stack: '',
    trace_id: (req.get('x-trace-id') as string) || uuid,
    span_id: uuid,
    parent_span_id: (req.get('x-parent-span-id') as string) || '',
    user_id: (req.get('x-user-id') as string) || '',
    session_id: (req.get('x-session-id') as string) || '',
    project_slug: config.projectSlug,
    environment: config.environment,
    service_name: config.serviceName || '',
    host,
    process_id: String(process.pid),
    tags: {},
  };
}

function realClientIP(req: Request): string {
  const xff = req.get('x-forwarded-for') as string;
  if (xff) return xff.split(',')[0].trim();
  const xri = req.get('x-real-ip') as string;
  if (xri) return xri;
  return req.ip || req.socket.remoteAddress || '';
}

function detectClientType(req: Request): ClientType {
  const ct = req.get('x-client-type') as string;
  if (ct) return ct as ClientType;
  const ua = (req.get('user-agent') || '').toLowerCase();
  if (ua.includes('micromessenger') || ua.includes('miniprogram')) return 'miniprogram';
  if (req.get('x-caller-service')) return 'server';
  const referer = req.get('referer') as string;
  const origin = req.get('origin') as string;
  if ((referer || origin) && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox'))) {
    return 'web';
  }
  return 'other';
}

function detectOrigin(req: Request): string {
  switch (detectClientType(req)) {
    case 'web': return (req.get('referer') || req.get('origin') || '') as string;
    case 'miniprogram': return `miniprogram:${req.get('x-miniprogram-appid') || ''}${req.get('x-miniprogram-path') || ''}`;
    case 'app': return `app:${req.get('x-app-name') || ''}/${req.get('x-app-version') || ''}/${req.get('x-app-scene') || ''}`;
    case 'server': return `server:${req.get('x-caller-service') || ''}/${req.get('x-caller-version') || ''}`;
    default: return 'unknown';
  }
}

function sanitizeHeaders(headers: Record<string, any>): string {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    if (['authorization', 'cookie', 'set-cookie'].includes(k.toLowerCase())) {
      safe[k] = val.length > 20 ? val.slice(0, 15) + '...' : '***';
      continue;
    }
    safe[k] = val;
  }
  return JSON.stringify(safe);
}

function captureRequestBody(req: Request, maxSize: number): string {
  try {
    if (req.body) {
      if (typeof req.body === 'string') return truncate(req.body, maxSize);
      return truncate(JSON.stringify(req.body), maxSize);
    }
  } catch { /* 忽略无法读取的请求体 */ }
  return '';
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...[truncated]';
}

function extractAPIVersion(path: string): string { const m = path.match(/\/api\/(v\d+)\//); return m ? m[1] : ""; }
