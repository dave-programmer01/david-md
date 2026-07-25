/**
 * Bounded LRU with optional TTL.
 *
 * Used for the antidelete message buffer, group-metadata memoisation and the
 * antispam counters. All three would grow without limit on a busy account, so
 * every one of them is capped rather than relying on a plain Map.
 */
class LRU {
  constructor({ max = 500, ttl = 0 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  _expired(entry) {
    return this.ttl > 0 && Date.now() - entry.at > this.ttl;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this._expired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, at: Date.now() });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  /** Fetch through a loader, caching the result. */
  async fetch(key, loader) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    return this.set(key, value);
  }
}

module.exports = { LRU };
