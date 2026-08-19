import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '../../../server');

export type SaleState = 'upcoming' | 'active' | 'ended';

export function seedSale(state: SaleState, stock: number): void {
  // shell:true is required on Windows to resolve the npm.cmd shim; the args
  // are static literals from this file, never external input, so the
  // unescaped-argument risk that flag normally carries doesn't apply here.
  execFileSync(
    'npm',
    ['run', 'seed', '--', `--state=${state}`, `--stock=${stock}`],
    { cwd: SERVER_DIR, stdio: 'inherit', shell: true },
  );
}
