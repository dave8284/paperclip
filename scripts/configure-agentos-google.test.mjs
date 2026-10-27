import test from "node:test";
import assert from "node:assert/strict";
import { googleClientSettings, updateEnvironment } from "./configure-agentos-google.mjs";
const client = { web: { project_id: "agentos-dave8284", client_id: "fixture.apps.googleusercontent.com", client_secret: "fixture-secret", redirect_uris: ["http://localhost:3100/api/auth/callback/google"] } };
test("requires the correct project and web client without disclosing the secret", () => {
  assert.throws(() => googleClientSettings({ installed: client.web }, "http://localhost:3100"), /Web application/);
  assert.throws(() => googleClientSettings({ web: { ...client.web, project_id: "another-project" } }, "http://localhost:3100"), /AgentOS/);
  assert.equal(googleClientSettings(client, "http://localhost:3100").PAPERCLIP_GOOGLE_CLIENT_SECRET, "fixture-secret");
});
test("requires exact registered callbacks and a secure public origin", () => {
  assert.throws(() => googleClientSettings(client, "https://agentos.example.com"), /Register this exact/);
  assert.throws(() => googleClientSettings(client, "http://agentos.example.com"), /Use HTTPS/);
  assert.throws(() => googleClientSettings(client, "http://localhost:3100/path"), /only the application origin/);
});
test("preserves deployment mode and unrelated credentials when replacing Google settings", () => {
  const next = updateEnvironment('PAPERCLIP_DEPLOYMENT_MODE=local_trusted\nDATABASE_URL="unchanged"\nexport PAPERCLIP_GOOGLE_CLIENT_ID=old\n', googleClientSettings(client, "http://localhost:3100"));
  assert.match(next, /PAPERCLIP_DEPLOYMENT_MODE=local_trusted/); assert.match(next, /DATABASE_URL="unchanged"/);
  assert.equal(next.match(/PAPERCLIP_GOOGLE_CLIENT_ID=/g).length, 1); assert.doesNotMatch(next, /old/);
});
