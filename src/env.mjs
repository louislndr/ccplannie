// Load secrets from a local .env file (never committed) before anything reads process.env.
// Values already set in the shell win.
import { existsSync } from "node:fs";
const file = process.env.PLANNIE_ENV_FILE || ".env";
if (existsSync(file)) process.loadEnvFile(file);
