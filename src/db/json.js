const fs = require("fs");
const path = require("path");
const S = require("../settings");

/**
 * File-backed key/value store, one JSON file per collection.
 *
 * Reads are synchronous off an in-memory cache; writes are debounced and go
 * through a temp file + rename so a crash mid-write can never leave a
 * half-written settings file behind.
 */
class JsonStore {
  constructor(dir = S.DATA_DIR) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(collection) {
    return path.join(this.dir, `${collection}.json`);
  }

  _load(collection) {
    if (this.cache.has(collection)) return this.cache.get(collection);
    let data = {};
    const file = this._file(collection);
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8")) || {};
      } catch (err) {
        // A corrupt file must not take the whole bot down. Move it aside so
        // the user can recover it, and carry on with an empty collection.
        const bak = `${file}.corrupt-${Date.now()}`;
        try { fs.renameSync(file, bak); } catch {}
        console.error(`⚠️  ${collection}.json was unreadable (${err.message}). Moved to ${path.basename(bak)}.`);
        data = {};
      }
    }
    this.cache.set(collection, data);
    return data;
  }

  _flush(collection) {
    const file = this._file(collection);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.cache.get(collection) || {}, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`⚠️  Could not save ${collection}: ${err.message}`);
    }
  }

  _schedule(collection) {
    if (this.timers.has(collection)) clearTimeout(this.timers.get(collection));
    this.timers.set(
      collection,
      setTimeout(() => {
        this.timers.delete(collection);
        this._flush(collection);
      }, 250)
    );
  }

  async init() {}

  async get(collection, key, fallback = null) {
    const data = this._load(collection);
    return key in data ? data[key] : fallback;
  }

  async set(collection, key, value) {
    const data = this._load(collection);
    data[key] = value;
    this._schedule(collection);
    return value;
  }

  async del(collection, key) {
    const data = this._load(collection);
    delete data[key];
    this._schedule(collection);
  }

  async all(collection) {
    return { ...this._load(collection) };
  }

  async clear(collection) {
    this.cache.set(collection, {});
    this._schedule(collection);
  }

  /** Flush everything pending — called on shutdown. */
  async close() {
    for (const [collection, timer] of this.timers) {
      clearTimeout(timer);
      this._flush(collection);
    }
    this.timers.clear();
  }
}

module.exports = JsonStore;
