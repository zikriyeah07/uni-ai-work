import dotenv from 'dotenv';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, 'server', '.env') });

const result = spawnSync('prisma', process.argv.slice(2), { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
if (result.error) {
  console.error(`Could not run Prisma CLI: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
