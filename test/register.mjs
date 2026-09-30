// Test-only module hooks: map Pi host packages to the dev install in .dev/ and
// resolve extensionless relative imports (Pi loads extensions through jiti).
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
