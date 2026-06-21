# 日志管理平台 Node.js SDK

[English Documentation](https://github.com/xiaohao0725/logs-sdk-js/blob/main/README_EN.md) | [NPM](https://www.npmjs.com/package/@xiaohao0725/logs-sdk)

`@xiaohao0725/logs-sdk` 是日志管理平台的 Node.js / TypeScript SDK，提供 Express 和 Koa 中间件，一行代码即可自动采集 HTTP 请求的完整日志（请求/响应头体、客户端信息、设备信息、错误堆栈等），异步批量上报，对业务性能零影响。

## 功能特性

- ✅ **一行代码接入**：`app.use(logger.expressMiddleware())` / `app.use(logger.koaMiddleware())`
- ✅ **完整采集**：60+ 字段——请求头/体、响应头/体、客户端 IP/端口/类型、设备信息、TLS 版本、API 版本
- ✅ **自动识别**：客户端类型（Web / 小程序 / App / 服务端 / 其他）、请求来源（Referer / 微服务调用链）
- ✅ **错误捕获**：HTTP 5xx 自动标记 + 错误堆栈采集
- ✅ **UUID v7**：32 位十六进制无连字符，天然按时间排序
- ✅ **敏感脱敏**：Authorization / Cookie 自动脱敏，不记录明文
- ✅ **异步非阻塞**：环形缓冲区 + 后台定时刷新，不阻塞业务请求
- ✅ **离线缓存**：网络故障时自动缓存到本地文件，恢复后自动重传
- ✅ **优雅关闭**：`close()` 确保缓冲日志全部上报
- ✅ **TypeScript**：完整类型定义，IDE 智能提示

## 安装

```bash
npm install @xiaohao0725/logs-sdk
```

要求 Node.js 18+。

## 快速开始

### Express

```typescript
import express from 'express';
import { LogSDK } from '@xiaohao0725/logs-sdk';

const app = express();

// ① 创建客户端
const logger = new LogSDK({
  endpoint: 'https://api.logs.codexs.cn/api/v1/ingest/logs',
  apiKey: 'clog_pk_xxx',
  apiSecret: 'clog_sk_xxx',
  projectSlug: 'my-project',
  environment: 'production',
});

// ② 重传离线缓存的日志
await logger.flushOffline();

// ③ 注册 Express 中间件——一行代码接入
app.use(logger.expressMiddleware());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'hello' });
});

app.listen(3000);
```

### Koa

```typescript
import Koa from 'koa';
import { LogSDK } from '@xiaohao0725/logs-sdk';

const app = new Koa();
const logger = new LogSDK({...});

// Koa 中间件
app.use(logger.koaMiddleware());
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | `string` | **必填** | 日志上报地址 |
| `apiKey` | `string` | **必填** | SDK 认证密钥（公钥） |
| `apiSecret` | `string` | **必填** | SDK 认证密钥（私钥） |
| `projectSlug` | `string` | **必填** | 项目短标识 |
| `environment` | `string` | `"production"` | 运行环境：production / staging / development |
| `serviceName` | `string` | `""` | 微服务名称 |
| `bufferSize` | `number` | `1000` | 本地环形缓冲区容量，满 80% 自动 flush |
| `flushInterval` | `number` | `5` | 定时刷新间隔（秒） |
| `maxRetries` | `number` | `3` | 最大重试次数，指数退避 |
| `maxBodySize` | `number` | `4096` | 请求/响应体最大采集大小（字节） |
| `maxStackSize` | `number` | `8192` | 错误堆栈最大采集大小（字节） |

## 采集字段一览

与 Go SDK 完全对齐，详见 [LogEntry 类型定义](./src/types.ts)。

| 分类 | 字段 |
|------|------|
| 请求 | `method`, `scheme`, `full_url`, `host_header`, `path`, `query_string`, `origin`, `request_headers`, `request_body`, `request_body_size`, `content_type` |
| 响应 | `status_code`, `response_headers`, `response_body`, `response_body_size` |
| 客户端 | `client_ip`, `client_ip_chain`, `client_type`, `client_port` |
| 设备 | `user_agent`, `device_type`, `browser`, `browser_version`, `os_name`, `os_version` |
| TLS/协议 | `tls_version`, `tls_cipher`, `proto`, `api_version`, `referer` |
| 追踪 | `trace_id`, `span_id`, `parent_span_id`, `user_id`, `session_id`, `request_id` |
| 错误 | `is_error`, `error_type`, `error_message`, `error_stack` |

## 架构设计

```
HTTP 请求进入
  │
  ├─ ① expressMiddleware() / koaMiddleware()
  │     ├─ 生成 UUID v7（32 位无连字符）
  │     ├─ 读取请求体（缓存以支持后续中间件读取）
  │     └─ 记录开始时间（hrtime）
  │
  ├─ ② 业务 Handler
  │
  ├─ ③ 劫持 res.end 捕获响应体
  │     └─ 构建 LogEntry（60+ 字段）
  │
  ├─ ④ 写入环形缓冲区（非阻塞）
  │
  └─ ⑤ 后台定时刷新（每 5s 或缓冲 80% 满）
        └─ 批量 POST 到 Ingestion API → 重试 → 失败则离线缓存
```

## 离线缓存

网络故障时，SDK 自动将日志保存到系统临时目录：

```
$TMPDIR/logs-sdk-offline/
├── offline-2026-06-21T12-00-00.json
├── offline-2026-06-21T12-00-05.json
└── ...
```

- 最大缓存 50MB，超过自动清理旧文件
- 超过 24 小时的缓存自动删除
- 调用 `flushOffline()` 或 `close()` 时自动重传

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.3.0 | 2026-06-21 | 新增 TLS/协议/API版本/Referer/耗时分解/request_id 等 8 字段 |
| v0.2.0 | 2026-06-21 | 新增离线缓存（断网本地存储，恢复自动重传） |
| v0.1.0 | 2026-06-21 | 初始版本：Express/Koa 中间件、异步缓冲、重试 |

## License

UNLICENSED — 内部使用
