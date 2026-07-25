const S = require("../settings");

/**
 * Postgres-backed store, same interface as JsonStore.
 *
 * This exists for Heroku, where the filesystem is wiped roughly daily and a
 * JSON-file store would silently lose every setting the user configured.
 *
 * Values are mirrored into an in-memory cache on init so the hot path (the
 * message router reading the prefix on every single message) stays synchronous
 * in practice rather than issuing a query per message.
 */
class PostgresStore {
  constructor(url = S.DATABASE_URL) {
    this.url = url;
    this.cache = new Map();
  }

  async init() {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch {
      throw new Error("DATABASE_URL is set but the 'pg' package is missing. Run: npm install pg");
    }

    this.pool = new Pool({
      connectionString: this.url,
      ssl: /localhost|127\.0\.0\.1/.test(this.url) ? false : { rejectUnauthorized: false },
      max: 4,
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS david_kv (
        collection TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      JSONB,
        PRIMARY KEY (collection, key)
      )
    `);

    const { rows } = await this.pool.query("SELECT collection, key, value FROM david_kv");
    for (const row of rows) {
      if (!this.cache.has(row.collection)) this.cache.set(row.collection, {});
      this.cache.get(row.collection)[row.key] = row.value;
    }
    console.log(`🗄️  Postgres connected — ${rows.length} settings loaded.`);
  }

  _local(collection) {
    if (!this.cache.has(collection)) this.cache.set(collection, {});
    return this.cache.get(collection);
  }

  async get(collection, key, fallback = null) {
    const data = this._local(collection);
    return key in data ? data[key] : fallback;
  }

  async set(collection, key, value) {
    this._local(collection)[key] = value;
    await this.pool.query(
      `INSERT INTO david_kv (collection, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (collection, key) DO UPDATE SET value = EXCLUDED.value`,
      [collection, key, JSON.stringify(value)]
    );
    return value;
  }

  async del(collection, key) {
    delete this._local(collection)[key];
    await this.pool.query("DELETE FROM david_kv WHERE collection = $1 AND key = $2", [collection, key]);
  }

  async all(collection) {
    return { ...this._local(collection) };
  }

  async clear(collection) {
    this.cache.set(collection, {});
    await this.pool.query("DELETE FROM david_kv WHERE collection = $1", [collection]);
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

module.exports = PostgresStore;
