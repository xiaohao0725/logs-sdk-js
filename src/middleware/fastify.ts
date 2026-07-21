// Fastify 插件 — 自动采集所有 HTTP 请求日志
import type { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import type { LogSDK } from '../client';
import { newLogUUID } from '../client';
import type { LogEntry, ClientType } from '../types';

/**
 * 创建 Fastify 日志采集插件。
 * 自动采集：请求头/体、响应头/体、客户端信息、错误堆栈、耗时统计。
 */
export function createFastifyPlugin(sdk: LogSDK) {
  const config = sdk.configResolved;

  return function fastifyLogsPlugin(
    fastify: FastifyInstance,
    _opts: Record<string, unknown>,
    done: HookHandlerDoneFunction
  ) {
    // 记录请求开始时间
    fastify.decorateRequest('_logsStartTime', 0);
    fastify.decorateRequest('_logsStartHrTime', 0);
    fastify.decorateRequest('_logsUUID', '');

    fastify.addHook('onRequest', async (request) => {
      (request as any)._logsStartTime = Date.now();
      (request as any)._logsStartHrTime = process.hrtime.bigint();
      (request as any)._logsUUID = newLogUUID();
    });

    // 响应发送时采集日志
    fastify.addHook('onSend', async (request, reply, payload) => {
      const startTime = (request as any)._logsStartTime as number;
      const startHrTime = (request as any)._logsStartHrTime as bigint;
      const entryUUID = (request as any)._logsUUID as string;

      if (!startTime) return payload;

      const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
      const reqBody = captureFastifyBody(request, config.maxBodySize);
      const respBody = captureFastifyResponse(payload, config.maxBodySize);

      const entry = buildFastifyEntry(
        request, reply, entryUUID, startTime, durationMs,
        reqBody, respBody, config, sdk.host
      );

      entry.tls_version = (request.raw.socket as any)?.getProtocol?.() || '';
      entry.tls_cipher = (request.raw.socket as any)?.getCipher?.()?.name || '';
      entry.proto = request.raw.httpVersion;
      entry.api_version = extractFastifyVersion(request.routeOptions?.url || request.url);
      entry.referer = (request.headers.referer as string) || '';
      entry.request_id = entryUUID.slice(0, 8);

      if (reply.statusCode >= 400) {
        entry.is_error = true;
        entry.error_type = 'http_error';
        entry.error_message = entry.response_body;
        if (reply.statusCode >= 500) entry.error_stack = new Error().stack || '';
      }

      sdk.send(entry);
      return payload;
    });

    // 捕获未处理的异常
    fastify.addHook('onError', async (request, _reply, error) => {
      const startTime = (request as any)._logsStartTime as number;
      const startHrTime = (request as any)._logsStartHrTime as bigint;
      const entryUUID = (request as any)._logsUUID as string;
      if (!startTime) return;

      const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
      const entry = buildFastifyEntry(
        request, _reply, entryUUID, startTime, durationMs,
        '', '', config, sdk.host
      );
      entry.is_error = true;
      entry.error_type = 'panic';
      entry.error_message = error?.message || String(error);
      entry.error_stack = error?.stack || '';
      sdk.send(entry);
    });

    done();
  };
}

/** 从 Fastify Request 构建 LogEntry */
function buildFastifyEntry(
  request: FastifyRequest,
  reply: FastifyReply,
  uuid: string,
  startTime: number,
  durationMs: number,
  reqBody: string,
  respBody: string,
  config: any,
  host: string,
): LogEntry {
  const scheme = request.protocol;
  const fullURL = `${scheme}://${request.hostname}${request.url}`;

  return {
    uuid,
    timestamp: new Date(startTime).toISOString(),
    duration_ms: Math.round(durationMs),
    method: request.method,
    scheme,
    full_url: fullURL,
    host_header: request.hostname || '',
    path: request.routeOptions?.url || request.url.split('?')[0],
    query_string: JSON.stringify(request.query),
    origin: detectFastifyOrigin(request),
    request_headers: sanitizeFastifyHeaders(request.headers),
    request_body: truncate(reqBody, config.maxBodySize),
    request_body_size: Buffer.byteLength(reqBody),
    content_type: (request.headers['content-type'] as string) || '',
    status_code: reply.statusCode,
    response_headers: sanitizeFastifyHeaders(reply.getHeaders()),
    response_body: truncate(respBody, config.maxBodySize),
    response_body_size: Buffer.byteLength(respBody),
    client_ip: request.ip,
    client_ip_chain: (request.headers['x-forwarded-for'] as string) || '',
    client_type: detectFastifyClientType(request),
    client_port: 0,
    user_agent: (request.headers['user-agent'] as string) || '',
    is_error: false,
    error_message: '',
    error_type: '',
    error_stack: '',
    trace_id: (request.headers['x-trace-id'] as string) || uuid,
    span_id: uuid,
    parent_span_id: (request.headers['x-parent-span-id'] as string) || '',
    user_id: (request.headers['x-user-id'] as string) || '',
    session_id: (request.headers['x-session-id'] as string) || '',
    project_slug: config.projectSlug,
    environment: config.environment,
    service_name: config.serviceName || '',
    host,
    process_id: String(process.pid),
    tags: {},
  };
}

function detectFastifyClientType(request: FastifyRequest): ClientType {
  const ct = request.headers['x-client-type'] as string;
  if (ct) return ct as ClientType;
  const ua = ((request.headers['user-agent'] as string) || '').toLowerCase();
  if (ua.includes('micromessenger') || ua.includes('miniprogram')) return 'miniprogram';
  if (request.headers['x-caller-service']) return 'server';
  const referer = request.headers.referer as string;
  const origin = request.headers.origin as string;
  if ((referer || origin) && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox'))) {
    return 'web';
  }
  return 'other';
}

function detectFastifyOrigin(request: FastifyRequest): string {
  switch (detectFastifyClientType(request)) {
    case 'web': return ((request.headers.referer || request.headers.origin || '') as string);
    case 'miniprogram': return `miniprogram:${request.headers['x-miniprogram-appid'] || ''}${request.headers['x-miniprogram-path'] || ''}`;
    case 'app': return `app:${request.headers['x-app-name'] || ''}/${request.headers['x-app-version'] || ''}/${request.headers['x-app-scene'] || ''}`;
    case 'server': return `server:${request.headers['x-caller-service'] || ''}/${request.headers['x-caller-version'] || ''}`;
    default: return 'unknown';
  }
}

function sanitizeFastifyHeaders(headers: Record<string, any>): string {
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

function captureFastifyBody(request: FastifyRequest, maxSize: number): string {
  try {
    if (request.body) {
      if (typeof request.body === 'string') return truncate(request.body, maxSize);
      return truncate(JSON.stringify(request.body), maxSize);
    }
  } catch { /* 忽略无法读取的请求体 */ }
  return '';
}

function captureFastifyResponse(payload: unknown, maxSize: number): string {
  try {
    if (typeof payload === 'string') return truncate(payload, maxSize);
    if (Buffer.isBuffer(payload)) return truncate(payload.toString('utf-8'), maxSize);
    if (payload && typeof payload === 'object') return truncate(JSON.stringify(payload), maxSize);
    return truncate(String(payload || ''), maxSize);
  } catch {
    return '';
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...[truncated]';
}

function extractFastifyVersion(path: string): string {
  if (!path) return '';
  const m = path.match(/\/api\/(v\d+)\//);
  return m ? m[1] : '';
}
