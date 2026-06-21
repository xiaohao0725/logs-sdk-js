// Koa 中间件 — 自动采集所有 HTTP 请求日志
import type { Context, Next } from 'koa';
import type { LogSDK } from '../client';
import { newLogUUID } from '../client';
import type { LogEntry, ClientType } from '../types';

/**
 * 创建 Koa 日志采集中间件。
 */
export function createKoaMiddleware(sdk: LogSDK) {
  const config = sdk.configResolved;

  return async (ctx: Context, next: Next) => {
    const entryUUID = newLogUUID();
    const startTime = Date.now();
    const startHrTime = process.hrtime.bigint();

    const reqBody = captureKoaRequestBody(ctx, config.maxBodySize);

    // 捕获响应体
    const chunks: Buffer[] = [];
    const origWrite = ctx.res.write;
    const origEnd = ctx.res.end;

    ctx.res.write = ((chunk: any, encoding: any, callback: any) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return origWrite.call(ctx.res, chunk, encoding, callback);
    }) as any;

    ctx.res.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const respBody = Buffer.concat(chunks).toString('utf-8');
      const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
      const entry = buildKoaEntry(ctx, entryUUID, startTime, durationMs, reqBody, respBody, config, sdk.host);

      if (ctx.status >= 500) {
        entry.is_error = true;
        entry.error_type = 'http_error';
      }

      sdk.send(entry);
      return origEnd.call(ctx.res, chunk, encoding, callback);
    }) as any;

    await next();
  };
}

function buildKoaEntry(
  ctx: Context,
  uuid: string,
  startTime: number,
  durationMs: number,
  reqBody: string,
  respBody: string,
  config: any,
  host: string,
): LogEntry {
  const scheme = ctx.protocol || (ctx.secure ? 'https' : 'http');
  const fullURL = `${scheme}://${ctx.host}${ctx.url}`;

  return {
    uuid,
    timestamp: new Date(startTime).toISOString(),
    duration_ms: Math.round(durationMs),
    method: ctx.method,
    scheme,
    full_url: fullURL,
    host_header: ctx.host || '',
    path: ctx.path,
    query_string: ctx.querystring || '',
    origin: detectKoaOrigin(ctx),
    request_headers: sanitizeKoaHeaders(ctx.headers),
    request_body: truncate(reqBody, config.maxBodySize),
    request_body_size: Buffer.byteLength(reqBody),
    content_type: ctx.get('content-type') || '',
    status_code: ctx.status,
    response_headers: sanitizeKoaHeaders(ctx.response.headers),
    response_body: truncate(respBody, config.maxBodySize),
    response_body_size: Buffer.byteLength(respBody),
    client_ip: ctx.ip || ctx.request.ip || '',
    client_ip_chain: (ctx.get('x-forwarded-for') as string) || '',
    client_type: detectKoaClientType(ctx),
    client_port: 0,
    user_agent: (ctx.get('user-agent') as string) || '',
    is_error: false,
    error_message: '',
    error_type: '',
    error_stack: '',
    trace_id: (ctx.get('x-trace-id') as string) || uuid,
    span_id: uuid,
    parent_span_id: (ctx.get('x-parent-span-id') as string) || '',
    user_id: (ctx.get('x-user-id') as string) || '',
    session_id: (ctx.get('x-session-id') as string) || '',
    project_slug: config.projectSlug,
    environment: config.environment,
    service_name: config.serviceName || '',
    host,
    process_id: String(process.pid),
    tags: {},
  };
}

function detectKoaClientType(ctx: Context): ClientType {
  const ct = ctx.get('x-client-type') as string;
  if (ct) return ct as ClientType;
  const ua = (ctx.get('user-agent') || '').toLowerCase();
  if (ua.includes('micromessenger') || ua.includes('miniprogram')) return 'miniprogram';
  if (ctx.get('x-caller-service')) return 'server';
  const referer = ctx.get('referer') as string;
  const origin = ctx.get('origin') as string;
  if ((referer || origin) && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox'))) {
    return 'web';
  }
  return 'other';
}

function detectKoaOrigin(ctx: Context): string {
  switch (detectKoaClientType(ctx)) {
    case 'web': return (ctx.get('referer') || ctx.get('origin') || '') as string;
    case 'miniprogram': return `miniprogram:${ctx.get('x-miniprogram-appid') || ''}${ctx.get('x-miniprogram-path') || ''}`;
    case 'app': return `app:${ctx.get('x-app-name') || ''}/${ctx.get('x-app-version') || ''}/${ctx.get('x-app-scene') || ''}`;
    case 'server': return `server:${ctx.get('x-caller-service') || ''}/${ctx.get('x-caller-version') || ''}`;
    default: return 'unknown';
  }
}

function sanitizeKoaHeaders(headers: Record<string, any>): string {
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

function captureKoaRequestBody(ctx: Context, maxSize: number): string {
  try {
    const body = (ctx.request as any).body;
    if (body) {
      if (typeof body === 'string') return truncate(body, maxSize);
      return truncate(JSON.stringify(body), maxSize);
    }
  } catch { /* ignore */ }
  return '';
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...[truncated]';
}
