import { openSqliteStore } from "./sqlite-schema.mjs";
import { createModelPolicy } from "./model-policy.mjs";
import { storageRequests, runSync, routingSubscriptions, readOnlyMethods, normalizeStorageRows } from "./storage-effects.mjs";
export { POLICY_VERSION, ROLLOUT_POLICY_VERSION, COMPARISON_POLICY_VERSION, classifyWork, taskFamilyCatalog } from "./model-policy.mjs";

/** Embedded synchronous API retained for existing hosts. Each public operation
 * shares one transaction across its evidence and derived routing changes. */
export function createModelIntelligence(path) {
  const db = openSqliteStore(path), programs = createModelPolicy(storageRequests), subscriptions = routingSubscriptions();
  const api = Object.fromEntries(Object.entries(programs).map(([name, program]) => [name, (...args) => {
    let changed = false;
    db.exec(readOnlyMethods.has(name) ? "BEGIN" : "BEGIN IMMEDIATE");
    let result;
    try {
      result = runSync(program(...args), effect => {
        if (effect.kind === "routingChanged") { changed = true; return; }
        const statement = db.prepare(effect.sql);
        if (effect.method === "run") return statement.run(...effect.parameters);
        statement.setReadBigInts(true);
        const rows = normalizeStorageRows(statement.all(...effect.parameters));
        return effect.method === "get" ? rows[0] : rows;
      });
      db.exec("COMMIT");
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    // Notifications run after commit and outside its rollback/error boundary.
    if (changed) subscriptions.notify();
    return result;
  }]));
  return { ...api, subscribeRoutingWork: subscriptions.subscribe, close() { subscriptions.clear(); db.close(); } };
}
