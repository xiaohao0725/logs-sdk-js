// 指数退避重试策略

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;  // 毫秒
  maxDelay: number;   // 毫秒
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  baseDelay: 500,   // 500ms
  maxDelay: 10000,  // 10s
};

/**
 * 使用指数退避策略重试执行异步函数。
 * 重试间隔: baseDelay * 2^attempt，最大不超过 maxDelay。
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...defaultRetryConfig, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        cfg.baseDelay * Math.pow(2, attempt - 1),
        cfg.maxDelay,
      );
      await sleep(delay);
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
