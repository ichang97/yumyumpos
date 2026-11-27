export function createMemoryRateLimiter({
  limit = 20,
  periodSeconds = 60,
  maxKeys = 10000,
} = {}) {
  const windowMs = periodSeconds * 1000;
  const buckets = new Map();

  function pruneStale(now) {
    const cutoff = now - windowMs;
    for (const [k, timestamps] of buckets.entries()) {
      const recent = timestamps.filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        buckets.delete(k);
      } else {
        buckets.set(k, recent);
      }
    }
  }

  return {
    async limit({ key }) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const normalizedKey = String(key || 'unknown');
      const existing = buckets.get(normalizedKey) || [];
      const recent = existing.filter((ts) => ts > cutoff);

      if (recent.length >= limit) {
        buckets.set(normalizedKey, recent);
        return { success: false };
      }

      recent.push(now);
      buckets.set(normalizedKey, recent);

      if (buckets.size > maxKeys) {
        pruneStale(now);
      }

      return { success: true };
    },
  };
}
