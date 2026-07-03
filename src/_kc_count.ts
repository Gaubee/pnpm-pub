import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const kt: any = require("@github/keytar");
for (const svc of ["pnpm-pub", "pnpm-pub-test-sandbox"]) {
  const creds = await kt.findCredentials(svc);
  console.log(`${svc}: ${creds.length} entries`);
  for (const c of creds) console.log("  -", c.account);
}
