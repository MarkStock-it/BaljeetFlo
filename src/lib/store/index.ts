import { MariaDbStore } from "./mariadb";
import { createSeededMemoryStore } from "./seed";
import type { DataStore } from "./types";

/**
 * One store for the whole server process.
 *
 * Next bundles every route handler separately, so a plain module-level
 * `let store` gets duplicated, so each route would end up with its own empty
 * database, and a session created by /api/auth would 401 everywhere else.
 * Hanging it off globalThis keeps a single instance across route bundles and
 * survives hot reloads.
 */
declare global {
  // eslint-disable-next-line no-var
  var __budgetflowStore: { store: DataStore; version: number } | undefined;
}

/**
 * Bump this whenever the DataStore interface changes.
 *
 * The cached instance lives across hot reloads, so without a stamp a dev server
 * would keep serving an object built from the previous class, so a method added
 * today would be "not a function" until a manual restart. Bumping the stamp
 * quietly rebuilds the store instead.
 */
const STORE_VERSION = 5;

function hasDbCredentials() {
  return Boolean(
    process.env.MARIADB_HOST && process.env.MARIADB_USER && process.env.MARIADB_DATABASE
  );
}

export function getStore(): DataStore {
  const cached = globalThis.__budgetflowStore;
  if (cached && cached.version === STORE_VERSION) return cached.store;

  const store = hasDbCredentials()
    ? new MariaDbStore()
    : // DB credentials not configured (e.g. DCISM servers offline): dev/demo mode.
      createSeededMemoryStore();

  globalThis.__budgetflowStore = { store, version: STORE_VERSION };
  return store;
}

export * from "./types";
