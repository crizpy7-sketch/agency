// Resolve Playwright whether it is installed locally or globally in this image.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pw;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { pw = require(p); break; } catch { /* try next */ }
}
if (!pw) throw new Error('playwright not found (tried local and /opt/node22/lib/node_modules)');

export const { chromium, firefox, webkit, devices } = pw;
export default pw;
