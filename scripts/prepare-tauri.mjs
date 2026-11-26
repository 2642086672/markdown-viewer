import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'src-tauri', 'ui');

mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, 'md-viewer.html'), join(outDir, 'index.html'));
copyFileSync(join(root, 'tauri-shim.js'), join(outDir, 'tauri-shim.js'));

console.log('Tauri UI prepared in', outDir);