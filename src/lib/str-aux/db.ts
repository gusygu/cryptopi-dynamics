import { Pool } from "pg";
import type { StrAuxDoc, WindowKey } from "@/lab/str-aux/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

type Key = { base: string; quote: string; window: WindowKey; appSessionId: string };

function rowToDoc(row: any): StrAuxDoc {
  return {
    id: row.id,
    pair: {
      base: row.pair_base,
      quote: row.pair_quote,
      window: row.window_key,
      appSessionId: row.app_session_id,
    },
    opening: row.opening,
    nuclei: row.nuclei,
    stats: row.stats,
    stream: row.stream,
    updatedAt: Math.round(Number(row.updated_ms)),
  };
}

export const db = {
  pool,

  async upsert(doc: StrAuxDoc & { appSessionId: string }) {
    const q = `
      INSERT INTO strategy_aux.str_aux_doc
        (id, pair_base, pair_quote, window_key, app_session_id,
         opening, nuclei, stats, stream, updated_ms)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        opening    = EXCLUDED.opening,
        nuclei     = EXCLUDED.nuclei,
        stats      = EXCLUDED.stats,
        stream     = EXCLUDED.stream,
        updated_ms = EXCLUDED.updated_ms
      RETURNING *`;
    const v = [
      doc.id, doc.pair.base, doc.pair.quote, doc.pair.window, doc.pair.appSessionId!,
      JSON.stringify(doc.opening), JSON.stringify(doc.nuclei),
      JSON.stringify(doc.stats), JSON.stringify(doc.stream), doc.updatedAt
    ];
    const r = await pool.query(q, v);
    return r.rows[0];
  },

  async getLatest(key: Key): Promise<StrAuxDoc | null> {
    const q = `
      SELECT *
      FROM strategy_aux.str_aux_doc
      WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
      ORDER BY updated_ms DESC
      LIMIT 1`;
    const v = [key.base, key.quote, key.window, key.appSessionId];
    const r = await pool.query(q, v);
    if (!r.rowCount) return null;
    return rowToDoc(r.rows[0]);
  },

  // ---- snapshots ----
  async insertSnapshot(doc: StrAuxDoc & { appSessionId: string }) {
    const q = `
      INSERT INTO strategy_aux.str_aux_snapshot
        (doc_id, pair_base, pair_quote, window_key, app_session_id, payload, updated_ms)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7)
      RETURNING snapshot_id`;
    const v = [
      doc.id, doc.pair.base, doc.pair.quote, doc.pair.window, doc.pair.appSessionId!,
      JSON.stringify(doc), doc.updatedAt
    ];
    const r = await pool.query(q, v);
    return r.rows[0];
  },

  async getLatestSnapshot(key: Key): Promise<StrAuxDoc | null> {
    const q = `
      SELECT payload
      FROM strategy_aux.str_aux_snapshot
      WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3 AND app_session_id=$4
      ORDER BY updated_ms DESC
      LIMIT 1`;
    const v = [key.base, key.quote, key.window, key.appSessionId];
    const r = await pool.query(q, v);
    if (!r.rowCount) return null;
    return r.rows[0].payload as StrAuxDoc;
  },

  async writeThroughUpsert(doc: StrAuxDoc & { appSessionId: string }) {
    const saved = await this.upsert(doc);
    await this.insertSnapshot(doc);
    return saved;
  },
};
