import { cpSync } from 'node:fs';

for (const name of ['config', 'migrations']) {
  cpSync(new URL(`../backend/${name}/`, import.meta.url),
    new URL(`../backend/dist/${name}/`, import.meta.url), { recursive: true });
}
