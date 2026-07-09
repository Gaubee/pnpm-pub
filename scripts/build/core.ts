import { build } from "vite-plus/pack";

import { corePackConfig } from "./core-config.js";

await build({ config: false, ...corePackConfig });
