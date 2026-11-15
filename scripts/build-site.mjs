import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import '../versions/history-data.js';

const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
const files = [
  ['qcd_magic_prototype.html', 'index.html'],
  ['qcd_magic_prototype.html', 'qcd_magic_prototype.html'],
  ['LICENSE', 'LICENSE'],
  ['versions/index.html', 'versions/index.html'],
  ['versions/history-data.js', 'versions/history-data.js'],
  ...globalThis.QCD_HISTORY.map(({ file }) => [`versions/${file}`, `versions/${file}`])
];

await rm(output, { recursive: true, force: true });
await mkdir(new URL('versions/', output), { recursive: true });
for (const [source, destination] of files) {
  await copyFile(new URL(source, root), new URL(destination, output));
}
console.log(`Static site ready: ${fileURLToPath(output)}`);
