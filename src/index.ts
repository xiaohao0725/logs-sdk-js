// 日志管理平台 Node.js SDK 入口
// 提供 Express/Koa/Fastify 中间件，一行代码接入日志采集
//
// 使用方法：
//
//   import { LogSDK } from '@xiaohao0725/logs-sdk';
//
//   const logger = new LogSDK({
//     endpoint: 'https://api.logs.codexs.cn/api/v1/ingest/logs',
//     apiKey: 'clog_pk_xxx',
//     apiSecret: 'clog_sk_xxx',
//     projectSlug: 'my-project',
//     environment: 'production',
//   });
//
//   app.use(logger.expressMiddleware());       // Express
//   app.use(logger.koaMiddleware());           // Koa
//   app.register(logger.fastifyPlugin());      // Fastify

export { LogSDK, newLogUUID } from './client';
export { RingBuffer } from './buffer';
export { OfflineCache } from './offline';
export { retryWithBackoff } from './retry';
export type {
  LogSDKConfig,
  LogEntry,
  ClientType,
  ErrorType,
  ResolvedConfig,
} from './types';
