import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import '../versions/history-data.js';

const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
const archiveFiles = ['index.html', 'history-data.js', ...globalThis.QCD_HISTORY.map(({ file }) => file)];

before(async () => {
  await mkdir(output, { recursive: true });
  await writeFile(new URL('stale-file.txt', output), 'Must not survive a rebuild.');
  execFileSync(process.execPath, ['scripts/build-site.mjs'], { cwd: fileURLToPath(root) });
});

describe('Static site packaging', () => {
  it('publishes only the intended files and removes stale output', async () => {
    assert.deepEqual((await readdir(output)).sort(), [
      'LICENSE', 'index.html', 'qcd_magic_prototype.html', 'versions'
    ]);
    assert.deepEqual((await readdir(new URL('versions/', output))).sort(), archiveFiles.toSorted());
  });

  it('keeps the homepage and original application URL byte-identical to the prototype', async () => {
    const source = await readFile(new URL('qcd_magic_prototype.html', root));
    for (const name of ['index.html', 'qcd_magic_prototype.html']) {
      assert.deepEqual(await readFile(new URL(name, output)), source);
    }
  });

  it('preserves the archive and license without rewriting source files', async () => {
    for (const name of ['LICENSE', ...archiveFiles.map(file => `versions/${file}`)]) {
      assert.deepEqual(await readFile(new URL(name, output)), await readFile(new URL(name, root)), name);
    }
  });
});
