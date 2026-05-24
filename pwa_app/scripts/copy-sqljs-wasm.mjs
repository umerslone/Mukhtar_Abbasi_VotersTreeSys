import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const targetDir = path.join(root, 'public');
const target = path.join(targetDir, 'sql-wasm.wasm');

if (existsSync(source)) {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log('Copied sql.js wasm to public/sql-wasm.wasm');
} else {
  console.warn('sql.js wasm not found yet; run after installing dependencies.');
}
