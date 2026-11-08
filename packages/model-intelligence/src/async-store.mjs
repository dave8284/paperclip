import { createModelPolicy } from "./model-policy.mjs";
import { storageRequests, runAsync, routingSubscriptions, readOnlyMethods } from "./storage-effects.mjs";

// A transaction receives only normalized query effects and owns commit/retry.
// Input snapshots cannot change while a remote connection or lock is pending.
export function createAsyncPolicyStore(transaction) {
  const programs = createModelPolicy(storageRequests), subscriptions = routingSubscriptions(), pending = new Set();
  let closed = false;
  const api = Object.fromEntries(Object.entries(programs).map(([name, program]) => [name, (...args) => {
    if (closed) return Promise.reject(new Error("Model Intelligence store is closed"));
    let inputs;
    try { inputs = structuredClone(args); } catch { return Promise.reject(new Error("Invalid Model Intelligence input")); }
    const operation = (async () => {
      const completed = await transaction({ name, readOnly: readOnlyMethods.has(name), namespace: typeof inputs[0] === "string" ? inputs[0] : inputs[0]?.namespace }, async query => {
        let changed = false;
        const result = await runAsync(program(...inputs), effect => {
          if (effect.kind === "routingChanged") { changed = true; return; }
          return query(effect);
        });
        return { result, changed };
      });
      if (completed.changed && !closed) subscriptions.notify();
      return completed.result;
    })();
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }]));
  return { ...api, subscribeRoutingWork: subscriptions.subscribe, async close() {
    closed = true; subscriptions.clear();
    await Promise.allSettled([...pending]);
  } };
}
