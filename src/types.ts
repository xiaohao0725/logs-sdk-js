// SDK 核心类型定义 — 与 Go SDK 完全对齐

/** SDK 客户端配置 */
export interface LogSDKConfig {
  /** 日志上报地址，如 "https://api.logs.codexs.cn/api/v1/ingest/logs" */
  endpoint: string;

  /** SDK 认证密钥（公钥） */
  apiKey: string;

  /** SDK 认证密钥（私钥），用于请求签名 */
  apiSecret: string;

  /** 项目短标识 */
  projectSlug: string;

  /** 当前运行环境：production/staging/development，默认 "production" */
  environment?: 'production' | 'staging' | 'development';

  /** 微服务名称 */
  serviceName?: string;

  /** 本地缓冲容量，默认 1000，满 80% 自动 flush */
  bufferSize?: number;

  /** 定时刷新间隔（秒），默认 5 */
  flushInterval?: number;

  /** 最大重试次数，默认 3 */
  maxRetries?: number;

  /** 请求/响应体最大采集大小（字节），默认 4096 */
  maxBodySize?: number;

  /** 错误堆栈最大采集大小（字节），默认 8192 */
  maxStackSize?: number;
}

/** 客户端类型 */
export type ClientType = 'web' | 'miniprogram' | 'app' | 'server' | 'other';

/** 错误类型 */
export type ErrorType = 'panic' | 'business_error' | 'http_error' | 'timeout';

/** 日志条目 — 与 Go SDK / ClickHouse 表完全对齐 */
export interface LogEntry {
  // ── 基础标识 ──
  uuid: string;
  timestamp: string;      // ISO 8601 UTC
  duration_ms: number;

  // ── 请求信息（完整采集）──
  method: string;
  scheme: string;
  full_url: string;
  host_header: string;
  path: string;
  query_string: string;
  origin: string;
  request_headers: string;  // JSON，敏感字段脱敏
  request_body: string;
  request_body_size: number;
  content_type: string;

  // ── 响应信息（完整采集）──
  status_code: number;
  response_headers: string;  // JSON
  response_body: string;
  response_body_size: number;

  // ── 客户端信息 ──
  client_ip: string;
  client_ip_chain: string;
  client_type: ClientType;
  client_port: number;
  user_agent: string;

  // ── 错误与堆栈 ──
  is_error: boolean;
  error_message: string;
  error_type: ErrorType | '';
  error_stack: string;
  panic_location?: string;

  // ── 关联与追踪 ──
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  user_id: string;
  session_id: string;

  // ── 来源信息 ──
  project_slug: string;
  environment: string;
  service_name: string;
  host: string;
  process_id: string;

  // ── 自定义扩展 ──
  tags?: Record<string, unknown>;
}

/** 内部配置（已合并默认值） */
export interface ResolvedConfig extends Required<LogSDKConfig> {}
