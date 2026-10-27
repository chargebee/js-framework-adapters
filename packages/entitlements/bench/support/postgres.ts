import type { Pool } from "pg";
import {
	type EntitlementsStorage,
	parseSerializedEntitlementsSnapshot,
	serializeEntitlementsSnapshot,
} from "../../src/cache";

/**
 * Durable snapshot store over Postgres. Rows never expire: the client serves
 * an expired snapshot while it refreshes, so `ttlMs` is ignored.
 */
export function createPostgresStore(pool: Pool): EntitlementsStorage {
	return {
		async get(key) {
			const { rows } = await pool.query<{ document: string }>(
				"select document from entitlements_snapshot where key = $1",
				[key],
			);
			const row = rows[0];
			if (!row) {
				return undefined;
			}

			return parseSerializedEntitlementsSnapshot(row.document);
		},
		async set(key, value) {
			await pool.query(
				`insert into entitlements_snapshot (key, document) values ($1, $2)
				on conflict (key) do update set document = excluded.document`,
				[key, serializeEntitlementsSnapshot(value)],
			);
		},
		async delete(key) {
			await pool.query("delete from entitlements_snapshot where key = $1", [
				key,
			]);
		},
		async clear() {
			await pool.query("truncate entitlements_snapshot");
		},
	};
}

export async function migrate(pool: Pool): Promise<void> {
	await pool.query(
		`create table if not exists entitlements_snapshot (
			key text primary key,
			document text not null
		)`,
	);
}
