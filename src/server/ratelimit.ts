/**
 * Simple in-memory rate limiter. No external dependencies.
 */

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitConfig {
  windowMs: number;      // Time window in ms
  maxRequests: number;   // Max requests per window
}

const buckets = new Map<string, RateBucket>();

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 30,        // 30 requests per minute
};

export function checkRateLimit(
  key: string,
  cfg: RateLimitConfig = DEFAULT_CONFIG
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: cfg.maxRequests, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= cfg.windowMs) {
    bucket.tokens = cfg.maxRequests;
    bucket.lastRefill = now;
  }

  if (bucket.tokens > 0) {
    bucket.tokens--;
    return {
      allowed: true,
      remaining: bucket.tokens,
      resetMs: cfg.windowMs - (now - bucket.lastRefill),
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetMs: cfg.windowMs - (now - bucket.lastRefill),
  };
}

export function createRateLimitMiddleware(cfg: RateLimitConfig = DEFAULT_CONFIG) {
  return (req: any, res: any, next: any) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const result = checkRateLimit(key, cfg);

    res.setHeader('X-RateLimit-Limit', cfg.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetMs / 1000));

    if (!result.allowed) {
      res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfterMs: result.resetMs,
      });
      return;
    }

    next();
  };
}

// Cleanup stale buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 5 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 60 * 1000).unref();
