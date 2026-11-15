import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, it } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../versions/history-data.js';

const versions = globalThis.QCD_HISTORY;
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
const archive = path.join(root, 'versions');
const historyURL = pathToFileURL(path.join(archive, 'index.html')).href;
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.browsers');
process.env.TEMP = process.env.TMP = path.join(artifacts, 'history-tmp');
const { chromium } = await import('playwright');
let browser;
let context;
let page;
let errors;
let externalRequests;

before(async () => {
  await mkdir(process.env.TEMP, { recursive: true });
  browser = await chromium.launch({ headless: true, downloadsPath: artifacts });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, reducedMotion: 'reduce' });
  errors = [];
  externalRequests = [];
  context.on('page', opened => {
    opened.on('pageerror', error => errors.push(error.message));
    opened.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  });
  page = await context.newPage();
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(errors, [], 'No uncaught errors in the viewer or its historical frames');
  assert.deepEqual(externalRequests, [], 'History works offline without external resources');
});

describe('Historical snapshots', () => {
  it('preserves fingerprints and distinguishes captures from reconstructions', async () => {
    assert.equal(versions.length, 5);
    assert.deepEqual(versions.map(version => version.origin), ['git', 'reconstructed', 'reconstructed', 'snapshot', 'snapshot']);
    const hashes = new Set();
    for (const version of versions) {
      const bytes = await readFile(path.join(archive, version.file));
      const hash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(hash, version.sha256, `${version.file} must remain an immutable historical snapshot`);
      hashes.add(hash);
      assert.ok(version.changes.length >= 2 && version.changes.length <= 4);
    }
    assert.equal(hashes.size, versions.length, 'The milestones are distinct files, not renamed copies of the latest version');
  });

  for (const version of versions) {
    it(`opens and runs ${version.file} independently`, async () => {
      await page.goto(pathToFileURL(path.join(archive, version.file)).href);
      assert.equal(await page.locator('#palette .piece').count(), 12);
      await page.locator('#toggleSound').click();
      await page.locator('#next2').click();
      assert.equal(await page.evaluate(() => slots.filter(Boolean).length), 2);
      assert.equal(await page.evaluate(() => analyzeCombination().valid), true);
      await page.locator('#next3').click();
      assert.equal(await page.evaluate(() => slots.filter(Boolean).length), 3);
      assert.equal(await page.evaluate(() => analyzeCombination().valid), true);
      await page.screenshot({ path: path.join(artifacts, `history-${version.id}.png`), fullPage: true });
      await page.locator('#reset').click();
      assert.equal(await page.evaluate(() => slots.filter(Boolean).length), 0);
      if (version.id !== 'original') {
        await page.locator('[data-theme-choice="instrument"]').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'instrument');
      }
    });
  }

  it('retains the first redesign with lower slots, reusable signs, and sequential examples', async () => {
    await page.goto(pathToFileURL(path.join(archive, '01-redesign.html')).href);
    const positions = await page.evaluate(() => ({
      slotsTop: document.querySelector('#slots').getBoundingClientRect().top,
      fieldBottom: document.querySelector('#field').getBoundingClientRect().bottom
    }));
    assert.ok(positions.slotsTop > positions.fieldBottom);
    await page.locator('.piece[data-id="u-r"]').click();
    await page.locator('.piece[data-id="u-r"]').click();
    assert.deepEqual(await page.evaluate(() => slots), ['u-r', 'u-r', null]);
    assert.equal(await page.locator('.piece[data-id="u-r"]').isVisible(), true);
    await page.locator('#next2').click();
    assert.equal(await page.locator('#cycleNote').textContent(), 'Пара 1 / 4');
    assert.equal(await page.locator('.stone-face, .dice').count(), 0);
  });

  it('retains the inventory stage with upper slots, stone sizes, and random examples', async () => {
    await page.goto(pathToFileURL(path.join(archive, '02-inventory.html')).href);
    const positions = await page.evaluate(() => ({
      slotsBottom: document.querySelector('.tray').getBoundingClientRect().bottom,
      fieldTop: document.querySelector('#field').getBoundingClientRect().top
    }));
    assert.ok(positions.slotsBottom < positions.fieldTop);
    assert.equal(await page.locator('.socket-outlines path').count(), 6);
    assert.equal(await page.locator('.examples .dice').count(), 3);
    await page.locator('.piece[data-id="u-r"]').click();
    assert.equal(await page.locator('.piece[data-id="u-r"]').isVisible(), false);
    await page.locator('.socket[data-slot="0"]').click();
    assert.equal(await page.locator('.piece[data-id="u-r"]').isVisible(), true);
    await page.locator('#next2').click();
    assert.equal(await page.locator('#cycleNote').textContent(), 'Случайная пара');
    assert.equal(await page.locator('#centerTarget').count(), 0);
  });

  it('retains Sozvuchie with flat stones, capacity lights, and direct socket insertion', async () => {
    await page.goto(pathToFileURL(path.join(archive, '04-direct-selection.html')).href);
    assert.equal(await page.locator('h1').textContent(), 'Созвучие');
    assert.deepEqual(await page.locator('.theme-switch button').allTextContents(), ['Алхимия', 'Схема']);
    assert.equal(await page.locator('.stone-bevel, .stone-edge').count(), 0);
    assert.equal(await page.locator('.capacity-dot:not(.spent)').count(), 3);
    assert.equal(await page.locator('.socket-target:enabled').count(), 12);
    await page.locator('.socket-target[data-insert="d-r"]').click();
    assert.deepEqual(await page.evaluate(() => slots), ['d-r', null, null]);
    assert.equal(await page.locator('.piece[data-id="d-r"]').isVisible(), false);
    assert.equal(await page.locator('.capacity-dot:not(.spent)').count(), 2);
    await page.locator('.socket[data-piece="d-r"]').click();
    assert.equal(await page.locator('.capacity-dot:not(.spent)').count(), 3);
  });
});

describe('History viewer', () => {
  it('switches real interactive snapshots and shows each step rationale', async () => {
    await page.goto(historyURL);
    assert.equal(await page.locator('.step').count(), versions.length);
    assert.equal(await page.locator('#previous').isDisabled(), true);
    for (const version of versions) {
      await page.locator(`[data-version="${version.id}"]`).click();
      await page.waitForFunction(file => document.querySelector('#prototype').getAttribute('src') === file, version.file);
      await page.frameLocator('#prototype').locator('#palette .piece').first().waitFor();
      const frame = page.frame({ name: 'prototype' });
      await frame.waitForURL(pathToFileURL(path.join(archive, version.file)).href);
      assert.equal(await page.locator('#stageTitle').textContent(), version.title);
      assert.equal(await page.locator('#question').textContent(), version.question);
      assert.deepEqual(await page.locator('#changes li').allTextContents(), version.changes);
      assert.equal(await page.locator('#changesLabel').isVisible(), true);
      assert.equal(await page.locator('.provenance, #originLabel, #fingerprint').count(), 0);
      assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-version'), version.id);
      assert.ok((await page.locator('#openVersion').getAttribute('href')).endsWith(version.file));
      assert.equal(await frame.locator('#palette .piece').count(), 12);
      await frame.locator('#next2').click();
      assert.equal(await frame.evaluate(() => analyzeCombination().valid), true);
      await page.locator(`[data-version="${version.id}"]`).click();
      assert.equal(await frame.evaluate(() => slots.filter(Boolean).length), 2, 'Selecting the current step does not reload it');
      assert.doesNotMatch(await page.locator('body').innerText(), /В окне выше|Из сохранённого коммита|Снимок рабочей версии|Восстановлено по истории правок|SHA-256/);
    }
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('.footer').textContent(), 'СОЗВУЧИЕ / АРХИВ');
    await page.screenshot({ path: path.join(artifacts, 'history-viewer-desktop.png'), fullPage: true });
  });

  it('supports direct links, browser history, keyboard selection, and unknown hashes', async () => {
    await page.goto(`${historyURL}#redesign`);
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'redesign');
    await page.locator('[data-version="inventory"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#inventory' && document.querySelector('[aria-current="step"]')?.dataset.version === 'inventory');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'redesign');
    assert.equal(await page.locator('#prototype').getAttribute('src'), '01-redesign.html');
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'inventory');
    assert.equal(await page.locator('#prototype').getAttribute('src'), '02-inventory.html');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'circle');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'direct-selection');
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('#prototype').getAttribute('src'), '04-direct-selection.html');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'circle');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'inventory');
    await page.goto(`${historyURL}#missing-version`);
    await page.waitForFunction(() => location.hash === '#original');
    assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-version'), 'original');
  });

  it('keeps the complete desktop composition visible in responsive overview frames', async () => {
    await page.goto(`${historyURL}#direct-selection`);
    const frame = page.frame({ name: 'prototype' });
    await frame.waitForURL(pathToFileURL(path.join(archive, '04-direct-selection.html')).href);
    for (const width of [320, 390, 768, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => {
        const preview = document.querySelector('#preview');
        return Math.abs(Number(preview.style.getPropertyValue('--preview-scale')) * 1440 - preview.clientWidth) < 1;
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Viewer overflows at ${width}px`);
      assert.equal(await frame.evaluate(() => innerWidth), 1440);
      const bounds = await page.evaluate(() => ({
        outer: document.querySelector('#preview').getBoundingClientRect().toJSON(),
        inner: document.querySelector('#prototype').getBoundingClientRect().toJSON()
      }));
      assert.ok(Math.abs(bounds.outer.width - bounds.inner.width) < 1);
      assert.ok(Math.abs(bounds.outer.height - bounds.inner.height) < 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'history-viewer-mobile.png'), fullPage: true });
  });

  it('opens snapshots at full size and keeps the working prototype a separate link', async () => {
    await page.goto(`${historyURL}#direct-selection`);
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'direct-selection');
    const opened = page.waitForEvent('popup');
    await page.locator('#openVersion').click();
    const snapshot = await opened;
    await snapshot.waitForLoadState();
    assert.equal(snapshot.url(), pathToFileURL(path.join(archive, '04-direct-selection.html')).href);
    assert.equal(await snapshot.locator('.orbit-slot').count(), 6);
    const working = page.waitForEvent('popup');
    await page.locator('.current-link').click();
    const prototype = await working;
    await prototype.waitForLoadState();
    assert.equal(prototype.url(), pathToFileURL(path.join(root, 'qcd_magic_prototype.html')).href);
    assert.equal(await prototype.locator('#centerTarget').count(), 1);
  });
});
