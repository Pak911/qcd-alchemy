import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, it } from 'node:test';
import { mkdir } from 'node:fs/promises';
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
  it('lists eight stages with concise descriptions', () => {
    assert.equal(versions.length, 8);
    for (const version of versions) {
      assert.ok(version.changes.length >= 2 && version.changes.length <= 4);
    }
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
  it('retains planetary signs, separate orbital decoration, and clear seal feedback', async () => {
    await page.goto(pathToFileURL(path.join(archive, '07-living-manuscript.html')).href);
    await page.locator('#languageSelect').selectOption('ru');
    assert.deepEqual(await page.evaluate(() => Object.values(families).map(family => family.name)), ['Марс', 'Венера', 'Луна']);
    assert.equal(await page.locator('.manuscript-inscription').count(), 6);
    assert.equal(await page.locator('.celestial-orbit > *').count(), 8);
    assert.equal(await page.locator('.celestial-orbit .moon').count(), 0);
    assert.ok(await page.locator('.rune-reverse .rune-glyph').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).strokeDasharray === 'none')));
    await page.locator('.piece[data-id="u-r"]').hover();
    assert.equal(await page.locator('#previewPath').getAttribute('d'), '');
    await page.locator('.piece[data-id="u-r"]').click();
    assert.equal(await page.locator('#focus').evaluate(node => node.classList.contains('focus-appearing')), true);
    await page.locator('.piece[data-id="ad-r"]').click();
    assert.equal(await page.locator('#sealBackplate').isVisible(), true);
    assert.equal(await page.locator('#alchemySeal .seal-object').getAttribute('d'), 'M0-6 6 0 0 6-6 0Z');
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('.ability-card .seal-object').count(), 1);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('.brand-instrument .quark').count(), 3);
    assert.equal(await page.locator('.brand-artifact').isVisible(), false);
  });

  it('retains localized feedback, distinct particle chords, and shared reservations', async () => {
    await page.goto(pathToFileURL(path.join(archive, '06-feedback-and-localization.html')).href);
    await page.locator('#languageSelect').selectOption('ru');
    assert.equal(await page.locator('.stone-face, .rune-mark, .ability-size').count(), 0);
    assert.equal(await page.locator('#languageSelect').evaluate(node => getComputedStyle(node).alignItems), 'center');
    await page.locator('.piece[data-id="u-r"]').click();
    assert.equal(await page.locator('#actionScale').getAttribute('data-ready'), 'false');
    await page.locator('.piece[data-id="ad-r"]').hover();
    assert.equal(await page.locator('#actionPreview').isVisible(), true);
    await page.locator('.piece[data-id="ad-r"]').click();
    assert.equal(await page.locator('#abilityName').textContent(), 'Малая печать отталкивания');
    await page.locator('#bindSeal').click();
    await page.evaluate(() => setRecipe(['d-r', 'u-g', 'd-b']));
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.waitForFunction(() => audio?.context.state === 'running');
    assert.equal(await page.locator('#stateName').textContent(), 'Барион');
    for (const locale of ['en', 'es', 'pt', 'zh', 'ru']) {
      await page.locator('#languageSelect').selectOption(locale);
      assert.equal(await page.evaluate(() => language), locale);
      assert.deepEqual(await page.evaluate(() => slots), ['d-r', 'u-g', 'd-b']);
      assert.deepEqual(await page.evaluate(() => reservedIds()), ['u-r', 'ad-r']);
      assert.equal(await page.evaluate(() => audio.stringKey), 'baryon:0');
      assert.equal(await page.evaluate(() => audio.strings.size), 3);
    }
    await page.locator('#releaseAll').click();
    assert.deepEqual(await page.evaluate(() => reservedIds()), []);
    assert.deepEqual(await page.evaluate(() => slots), ['d-r', 'u-g', 'd-b']);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => audio.strings.size), 0);
  });

  it('retains seal abilities, reserved ingredients, the named scale, and scientific states', async () => {
    await page.goto(pathToFileURL(path.join(archive, '05-seal-abilities.html')).href);
    assert.equal(await page.locator('h1').textContent(), 'Равновесие');
    assert.deepEqual(await page.locator('.action-value').allTextContents(), ['−2', '−1', '0', '+1', '+2']);
    assert.deepEqual(await page.locator('.action-name').allTextContents(), ['Сжатие', 'Притяжение', 'Удержание', 'Отталкивание', 'Рассеивание']);
    await page.locator('.piece[data-id="u-r"]').click();
    await page.locator('.piece[data-id="ad-r"]').click();
    assert.equal(await page.locator('#abilityName').textContent(), 'Малое отталкивание');
    assert.equal(await page.locator('#alchemySeal [data-action="repulsion"]').count(), 1);
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('.ability-slot').count(), 6);
    assert.equal(await page.locator('.ability-label').textContent(), 'Малое отталкивание');
    assert.equal(await page.locator('#inventoryCount').textContent(), '10 / 12');
    assert.equal(await page.locator('.piece[data-id="u-r"]').isVisible(), false);
    assert.equal(await page.locator('#actionMarker').isVisible(), false);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('h1').textContent(), 'Цветовой баланс');
    assert.equal(await page.locator('.ability-label').textContent(), 'Мезон · +1 e');
    await page.locator('[data-ability="0"]').click();
    assert.match(await page.locator('#runeTooltip').textContent(), /Красный u-кварк.*Примеры частиц.*пион π⁺/s);
    await page.locator('[data-release="0"]').click();
    assert.equal(await page.locator('#inventoryCount').textContent(), '12 / 12');
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
      assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-version'), version.id);
      assert.ok((await page.locator('#openVersion').getAttribute('href')).endsWith(version.file));
      assert.equal(await frame.locator('#palette .piece').count(), 12);
      await frame.locator('#next2').click();
      assert.equal(await frame.evaluate(() => analyzeCombination().valid), true);
      await page.locator(`[data-version="${version.id}"]`).click();
      assert.equal(await frame.evaluate(() => slots.filter(Boolean).length), 2, 'Selecting the current step does not reload it');
    }
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('.footer').textContent(), 'РАВНОВЕСИЕ / АРХИВ');
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
    assert.equal(await page.locator('#prototype').getAttribute('src'), '04-direct-selection.html');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'seal-abilities');
    assert.equal(await page.locator('#next').isDisabled(), false);
    assert.equal(await page.locator('#prototype').getAttribute('src'), '05-seal-abilities.html');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'feedback-and-localization');
    assert.equal(await page.locator('#next').isDisabled(), false);
    assert.equal(await page.locator('#prototype').getAttribute('src'), '06-feedback-and-localization.html');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'living-manuscript');
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('#prototype').getAttribute('src'), '07-living-manuscript.html');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'feedback-and-localization');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'seal-abilities');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'direct-selection');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'circle');
    await page.locator('#previous').click();
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'inventory');
    await page.goto(`${historyURL}#missing-version`);
    await page.waitForFunction(() => location.hash === '#original');
    assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-version'), 'original');
  });

  it('keeps the complete desktop composition visible in responsive overview frames', async () => {
    await page.goto(`${historyURL}#living-manuscript`);
    const frame = page.frame({ name: 'prototype' });
    await frame.waitForURL(pathToFileURL(path.join(archive, '07-living-manuscript.html')).href);
    for (const width of [320, 390, 768, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => {
        const preview = document.querySelector('#preview');
        return Math.abs(Number(preview.style.getPropertyValue('--preview-scale')) * 1440 - preview.clientWidth) < 1;
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Viewer overflows at ${width}px`);
      assert.equal(await frame.evaluate(() => innerWidth), 1440);
      assert.equal(await frame.evaluate(() => innerHeight), 1280);
      assert.ok(await frame.evaluate(() => document.querySelector('.abilities').getBoundingClientRect().bottom <= innerHeight), 'The ability panel fits in the archive preview');
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
    await page.goto(`${historyURL}#living-manuscript`);
    await page.waitForFunction(() => document.querySelector('[aria-current="step"]')?.dataset.version === 'living-manuscript');
    const opened = page.waitForEvent('popup');
    await page.locator('#openVersion').click();
    const snapshot = await opened;
    await snapshot.waitForLoadState();
    assert.equal(snapshot.url(), pathToFileURL(path.join(archive, '07-living-manuscript.html')).href);
    assert.equal(await snapshot.locator('.orbit-slot').count(), 6);
    assert.equal(await snapshot.locator('.ability-slot').count(), 6);
    assert.equal(await snapshot.locator('#languageSelect option').count(), 6);
    const working = page.waitForEvent('popup');
    await page.locator('.current-link').click();
    const prototype = await working;
    await prototype.waitForLoadState();
    assert.equal(prototype.url(), pathToFileURL(path.join(root, 'qcd_magic_prototype.html')).href);
    assert.equal(await prototype.locator('#centerTarget').count(), 1);
  });
});
