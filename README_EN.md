# Log Management Platform Node.js SDK

[中文文档](./README.md) | [NPM](https://www.npmjs.com/package/@xiaohao0725/logs-sdk)

`@xiaohao0725/logs-sdk` provides Express and Koa middleware with one-line integration for automatic HTTP request log collection.

## Features

- ✅ **One-line**: `app.use(logger.expressMiddleware())` / `app.use(logger.koaMiddleware())`
- ✅ **60+ fields**: request/response headers & body, client device info, TLS version, API version
- ✅ **Auto-detect**: client type (Web/MiniProgram/App/Server), request origin
- ✅ **Error capture**: HTTP 5xx auto-mark + stack trace collection
- ✅ **UUID v7**: 32-char hex without hyphens
- ✅ **Sanitization**: Authorization/Cookie auto-masking
- ✅ **Async**: ring buffer + background timer, non-blocking
- ✅ **Offline cache**: local file cache on failure, auto-retransmit
- ✅ **TypeScript**: full type definitions

## Installation

```bash
npm install @xiaohao0725/logs-sdk
```

Node.js 18+.

## Quick Start

```typescript
import express from 'express';
import { LogSDK } from '@xiaohao0725/logs-sdk';

const app = express();
const logger = new LogSDK({
  endpoint: 'https://api.logs.codexs.cn/api/v1/ingest/logs',
  apiKey: 'clog_pk_xxx', apiSecret: 'clog_sk_xxx',
  projectSlug: 'my-project', environment: 'production',
});
await logger.flushOffline();
app.use(logger.expressMiddleware());  // Express
// app.use(logger.koaMiddleware());   // Koa
app.listen(3000);
```

## Configuration / Collected Fields / Architecture

See [Go SDK README_EN.md](https://github.com/xiaohao0725/logs-sdk-go/blob/main/README_EN.md) — all SDKs share identical field definitions and architecture.

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.3.0 | 2026-06-21 | Added TLS/protocol/API version/Referer/request_id fields |
| v0.2.0 | 2026-06-21 | Added offline cache |
| v0.1.0 | 2026-06-21 | Initial release: Express/Koa middleware |

## License

UNLICENSED — Internal use
