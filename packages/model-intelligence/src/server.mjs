import { createServer } from "node:http";
import { createModelIntelligence } from "./index.mjs";
import { httpAuthFromEnvironment } from "./http-auth.mjs";
import { createHttpHandler } from "./http-handler.mjs";

// Validate credentials before opening storage or a listener. Configuration
// errors are deliberately generic: environment JSON can contain host secrets.
const authority = httpAuthFromEnvironment(process.env);
const store = createModelIntelligence(process.env.MODEL_INTELLIGENCE_DB ?? "./model-intelligence.sqlite");
const server = createServer(createHttpHandler(store, authority));
server.requestTimeout = 15000;
server.listen(Number(process.env.PORT ?? 3191), "127.0.0.1", () => console.log(`Model Intelligence ready on 127.0.0.1:${server.address().port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
