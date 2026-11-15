import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, it } from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.browsers');
process.env.TEMP = process.env.TMP = path.join(artifacts, 'tmp');
const { chromium } = await import('playwright');
const url = pathToFileURL(path.join(root, 'qcd_magic_prototype.html')).href;
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
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'ru-RU' });
  page = await context.newPage();
  errors = [];
  externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await page.goto(url);
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  assert.deepEqual(externalRequests, [], 'The standalone prototype must not depend on a network');
});

const piece = id => page.locator(`.piece[data-id="${id}"]`);
const state = () => page.locator('#chamber').getAttribute('data-state');
const selected = () => page.evaluate(() => [...slots]);
const socketTarget = id => page.locator(`.socket-target[data-insert="${id}"]`);

async function socketPoint(target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const large = await target.evaluate(node => node.classList.contains('socket-target-large'));
  return { x: box.x + box.width / 2, y: box.y + box.height * (large ? .12 : .5) };
}

describe('QCD rules and interaction', () => {
  it('opens directly from disk without a server or an initial success state', async () => {
    assert.equal(await page.title(), 'Равновесие · QCD');
    assert.equal(await page.locator('h1').textContent(), 'Равновесие');
    assert.equal(await page.locator('.brand-caption').count(), 0);
    assert.deepEqual(await page.locator('.theme-switch button').allTextContents(), ['Алхимия', 'Кварковая модель']);
    assert.equal(await page.locator('.piece').count(), 12);
    assert.equal(await page.locator('.socket').count(), 6);
    assert.equal(await page.locator('.socket.empty').count(), 6);
    assert.equal(await page.locator('.socket-target:enabled').count(), 12);
    assert.equal(await state(), 'empty');
    assert.equal(await page.locator('#chargeValue').textContent(), '0');
    assert.equal(await page.locator('details').getAttribute('open'), null);
    assert.equal(await page.evaluate(() => audio), null);
    assert.equal(await page.evaluate(() => frame), 0);
  });

  it('previews a contribution without changing the model or playing audio', async () => {
    await piece('u-r').hover();
    assert.equal(await page.locator('#preview').isVisible(), true);
    assert.equal(await page.locator('#previewDot').getAttribute('cy'), '240');
    assert.deepEqual(await selected(), [null, null, null]);
    assert.equal(await page.evaluate(() => audio), null);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#preview').isVisible(), false);
    await piece('u-r').click();
    await piece('ad-r').hover();
    assert.equal(await page.locator('#previewRing').isVisible(), true);
    assert.equal(await page.locator('#previewDot').getAttribute('cy'), '294');
  });

  it('previews charge on both scales from inventory and circle without moving the current marker', async () => {
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      const preview = page.locator(theme === 'artifact' ? '#actionPreview' : '#chargePreview');
      const marker = page.locator(theme === 'artifact' ? '#actionMarker' : '#chargeMarker');
      const position = theme === 'artifact' ? 'top' : 'left';
      assert.equal(await preview.isVisible(), false);
      await piece('u-r').hover();
      assert.equal(await preview.isVisible(), true);
      assert.ok(Math.abs(await preview.evaluate((node, prop) => parseFloat(node.style[prop]), position) - 200 / 3) < .001);
      assert.equal(await preview.evaluate(node => getComputedStyle(node).borderTopStyle), 'dashed');
      assert.deepEqual(await selected(), [null, null, null]);
      await page.keyboard.press('Escape');
      assert.equal(await preview.isVisible(), false);
      await piece('u-r').click();
      const current = await marker.getAttribute('style');
      await piece('ad-r').hover();
      assert.equal(await preview.evaluate((node, prop) => node.style[prop], position), '75%');
      const previewBox = await preview.boundingBox();
      const markerBox = await marker.boundingBox();
      assert.ok(Math.abs(previewBox.width - markerBox.width) < .01);
      assert.ok(Math.abs(previewBox.height - markerBox.height) < .01);
      assert.equal(await page.locator('#actionPreview').getAttribute('data-ready'), 'true');
      assert.equal(await marker.getAttribute('style'), current);
      await page.locator('h1').hover();
      assert.equal(await preview.isVisible(), false);
      const point = await socketPoint(socketTarget('ad-r'));
      await page.mouse.move(point.x, point.y);
      assert.equal(await preview.isVisible(), true);
      assert.equal(await preview.evaluate((node, prop) => node.style[prop], position), '75%');
      assert.equal(await marker.getAttribute('style'), current);
      await page.screenshot({ path: path.join(artifacts, `${theme}-scale-preview.png`), fullPage: true });
      await page.mouse.click(point.x, point.y);
      assert.equal(await preview.isVisible(), false);
      await socketTarget('d-g').focus();
      assert.equal(await preview.isVisible(), true);
      assert.equal(await page.locator('#actionPreview').getAttribute('data-ready'), 'false');
      await page.keyboard.press('Enter');
      await piece('u-b').hover();
      assert.equal(await preview.isVisible(), false, 'A full circle cannot preview another contribution');
      await page.locator('#reset').click();
      assert.equal(await preview.isVisible(), false);
      assert.equal(await page.locator('#preview').isVisible(), false);
    }
  });

  it('inserts the correct stone through each of the twelve circular hit regions', async () => {
    const inventory = await page.evaluate(() => pieces.map(p => ({ id: p.id, axis: `${p.color}-${p.anti}`, size: Math.abs(p.charge) === 2 ? 'large' : 'small' })));
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      for (const item of inventory) {
        const point = await socketPoint(socketTarget(item.id));
        await page.mouse.move(point.x, point.y);
        assert.equal(await page.locator(`[data-axis="${item.axis}"]`).getAttribute('data-preview-size'), item.size);
        assert.deepEqual(await selected(), [null, null, null], 'Hovering a socket does not place a stone');
        await page.mouse.click(point.x, point.y);
        assert.deepEqual(await selected(), [item.id, null, null]);
        assert.equal(await piece(item.id).isVisible(), false);
        assert.equal(await page.locator('.capacity-dot:not(.spent)').count(), 2);
        assert.equal(await page.locator('#preview').isVisible(), false);
        await page.locator(`.socket[data-piece="${item.id}"]`).click();
        assert.equal(await piece(item.id).isVisible(), true);
        assert.equal(await page.locator('.socket-target:enabled').count(), 12);
      }
    }
  });

  it('supports keyboard insertion and prevents a fourth stone through the circle', async () => {
    for (const id of ['u-r', 'ad-r', 'u-g']) {
      await socketTarget(id).focus();
      await page.keyboard.press(id === 'ad-r' ? 'Space' : 'Enter');
      assert.equal(await page.locator(`.socket[data-piece="${id}"]`).evaluate(node => document.activeElement === node), true);
    }
    assert.deepEqual(await selected(), ['u-r', 'ad-r', 'u-g']);
    assert.equal(await page.locator('.socket-target:enabled').count(), 0);
    const point = await socketPoint(socketTarget('u-b'));
    await page.mouse.move(point.x, point.y);
    assert.equal(await page.locator('#preview').isVisible(), false);
    await page.mouse.click(point.x, point.y);
    assert.deepEqual(await selected(), ['u-r', 'ad-r', 'u-g']);
    await page.locator('.socket[data-piece="ad-r"]').click();
    assert.equal(await socketTarget('u-b').isEnabled(), true);
    await socketTarget('u-b').focus();
    await page.keyboard.press('Enter');
    assert.equal(await state(), 'balanced');
    await page.locator('#reset').click();
    assert.equal(await page.locator('.socket-target:enabled').count(), 12);
  });

  it('highlights only the matching sub-socket for inventory hover', async () => {
    const axis = page.locator('[data-axis="red-false"]');
    const baseAppearance = () => axis.evaluate(node => ({
      opacity: getComputedStyle(node).opacity,
      strokes: [...node.querySelectorAll('.socket-outlines path')].map(path => getComputedStyle(path).stroke)
    }));
    const checkHighlight = async size => {
      assert.equal(await axis.getAttribute('data-preview-size'), size);
      const shape = await axis.evaluate((node, size) => {
        const glow = node.querySelector('.socket-highlight');
        const actual = glow.querySelector('path').getBoundingClientRect();
        const expected = node.querySelector(`.socket-outline-${size}`).getBoundingClientRect();
        return { opacity: getComputedStyle(glow).opacity, fill: getComputedStyle(glow).fill, dx: actual.x - expected.x, dy: actual.y - expected.y, dw: actual.width - expected.width, dh: actual.height - expected.height };
      }, size);
      assert.equal(shape.opacity, '1');
      assert.equal(shape.fill, 'none');
      assert.ok(['dx', 'dy', 'dw', 'dh'].every(key => Math.abs(shape[key]) < .1), 'Only the chosen outline receives the glow');
    };
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      for (const [id, size] of [['u-r', 'large'], ['d-r', 'small']]) {
        const before = await baseAppearance();
        await piece(id).hover();
        await checkHighlight(size);
        assert.deepEqual(await baseAppearance(), before, 'The whole socket and the other contour do not brighten');
        await page.locator('.field-wrap').screenshot({ path: path.join(artifacts, `socket-preview-${theme}-${size}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-preview-size]').count(), 0);
      }
      await piece('d-r').click();
      await piece('u-r').hover();
      await checkHighlight('large');
      await page.locator('#reset').click();
      await piece('u-r').click();
      await piece('d-r').hover();
      await checkHighlight('small');
      await page.locator('#reset').click();
    }
  });

  it('spends and restores the three capacity lights in both visual modes', async () => {
    const checkFree = async free => {
      assert.equal(await page.locator('.capacity-dot').count(), 3);
      assert.equal(await page.locator('.capacity-dot:not(.spent)').count(), free);
      assert.equal(await page.locator('.capacity-dot.spent').count(), 3 - free);
      assert.equal(await page.locator('#capacity').getAttribute('aria-label'), `Свободно мест: ${free} из 3`);
    };
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      if (await page.locator('#reset').isEnabled()) await page.locator('#reset').click();
      await checkFree(3);
      await piece('u-r').hover();
      await checkFree(3);
      for (const [index, id] of ['u-r', 'u-g', 'u-b'].entries()) {
        await piece(id).click();
        await checkFree(2 - index);
      }
      await piece('d-r').click({ force: true });
      await checkFree(0);
      await page.locator('.socket[data-piece="u-g"]').click();
      await checkFree(1);
      await piece('u-g').click();
      await checkFree(0);
      await page.locator('#reset').click();
      await checkFree(3);
      await page.locator('#next2').click();
      await checkFree(1);
      await page.locator('#next3').click();
      await checkFree(0);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const dots = await page.locator('#capacity').boundingBox();
        const field = await page.locator('#field').boundingBox();
        assert.ok(dots.y + dots.height <= field.y + 1, 'Capacity lights stay above the circle');
        assert.ok(Math.abs(dots.x + dots.width / 2 - field.x - field.width / 2) < 1, 'Capacity lights stay centered');
        await checkFree(0);
      }
    }
  });

  it('closes an opposite-colour pair and dims the unused directions', async () => {
    await piece('u-r').click();
    assert.equal(await state(), 'seeking');
    await piece('ad-r').click();
    assert.equal(await state(), 'balanced');
    assert.equal(await page.locator('#chargeValue').textContent(), '+1');
    assert.equal(await page.locator('.socket.optional').count(), 4);
    assert.equal(await page.locator('#resultSeal ellipse').count(), 2);
    assert.match(await page.locator('#physicalResult').textContent(), /π⁺/);
    assert.equal(await page.locator('#readout').getAttribute('data-balanced'), 'true');
    assert.equal(await page.evaluate(() => frame), 0, 'Reduced motion disables continuous animation');
  });

  it('does not celebrate integer electric charge when colour is unbalanced', async () => {
    await piece('u-r').click();
    await piece('ad-g').click();
    assert.equal(await page.locator('#chargeValue').textContent(), '+1');
    assert.equal(await state(), 'seeking');
    assert.equal(await page.locator('#chamber.arrived').count(), 0);
    assert.equal(await page.locator('#resultSeal').innerHTML(), '');
  });

  it('moves unique stones out of inventory and returns them on removal or reset', async () => {
    await piece('u-r').click();
    assert.equal(await piece('u-r').isVisible(), false);
    assert.equal(await page.locator('#inventoryCount').textContent(), '11 / 12');
    await page.evaluate(() => addPiece('u-r'));
    assert.deepEqual(await selected(), ['u-r', null, null], 'The same stone cannot be used twice');
    await piece('d-r').click();
    await piece('u-g').click();
    assert.equal(await page.locator('#chargeValue').textContent(), '+1');
    assert.equal(await state(), 'seeking');
    // A real pointer can still press an aria-disabled control; exercise its guard.
    await piece('u-b').click({ force: true });
    assert.deepEqual(await selected(), ['u-r', 'd-r', 'u-g']);
    assert.notEqual(await page.locator('#announcement').textContent(), '');
    await page.locator('.socket[data-slot="1"]').click();
    assert.deepEqual(await selected(), ['u-r', null, 'u-g']);
    assert.equal(await piece('d-r').isVisible(), true);
    assert.equal(await piece('d-r').evaluate(button => document.activeElement === button), true);
    await piece('u-b').click();
    assert.deepEqual(await selected(), ['u-r', 'u-b', 'u-g']);
    assert.equal(await state(), 'balanced');
    await page.locator('#reset').click();
    assert.equal(await state(), 'empty');
    assert.equal(await page.locator('#reset').isDisabled(), true);
    assert.equal(await page.locator('#announcement').textContent(), '');
    assert.equal(await page.locator('.piece:visible').count(), 12);
    assert.equal(await page.locator('#inventoryCount').textContent(), '12 / 12');
  });

  it('preserves all original combination rules across 1884 ordered selections', async () => {
    const result = await page.evaluate(() => {
      let checked = 0;
      let accepted = 0;
      const failures = [];
      const verify = ids => {
        checked++;
        const chosen = ids.map(id => byId[id]);
        const expected = ids.length === 2
          ? chosen[0].anti !== chosen[1].anti && chosen[0].color === chosen[1].color
          : ids.length === 3 && chosen.every(p => p.anti === chosen[0].anti) && new Set(chosen.map(p => p.color)).size === 3;
        const actual = analyzeCombination(ids);
        const vector = colorVector(ids);
        const zero = Math.hypot(vector.x, vector.y) < 1e-6;
        const point = { x: center.x + vector.x * vectorScale, y: center.y + vector.y * vectorScale };
        if (actual.valid) accepted++;
        if (actual.valid !== expected || (ids.length >= 2 && zero !== actual.valid)) failures.push(ids);
        if (actual.valid && (totalThirds(ids) % 3 !== 0 || !actual.analog || new Set(ids).size !== ids.length)) failures.push(ids);
        if (Math.hypot(point.x - center.x, point.y - center.y) > 163) failures.push(ids);
      };
      for (const a of pieces) {
        verify([a.id]);
        for (const b of pieces) {
          verify([a.id, b.id]);
          for (const c of pieces) verify([a.id, b.id, c.id]);
        }
      }
      return { checked, accepted, failures };
    });
    assert.deepEqual(result, { checked: 1884, accepted: 120, failures: [] });
  });

  it('places every stone on its own direction and returns it from the circle', async () => {
    const inventory = await page.evaluate(() => pieces.map(p => ({ id: p.id, axis: `${p.color}-${p.anti}` })));
    for (const item of inventory) {
      await piece(item.id).click();
      const placed = page.locator(`.socket[data-piece="${item.id}"]`);
      assert.equal(await placed.evaluate(node => node.closest('[data-axis]').dataset.axis), item.axis);
      assert.equal(await page.locator('.socket.filled').count(), 1);
      await placed.click();
      assert.equal(await piece(item.id).isVisible(), true);
      assert.equal(await state(), 'empty');
    }
  });

  it('keeps both magnitudes independently removable when they share a direction', async () => {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await piece('u-r').click();
      await piece('d-r').click();
      const shared = page.locator('[data-axis="red-false"]');
      assert.equal(await shared.locator('.socket.filled').count(), 2);
      for (const id of ['u-r', 'd-r']) {
        const button = page.locator(`.socket[data-piece="${id}"]`);
        await button.scrollIntoViewIfNeeded();
        const hit = await button.evaluate(node => {
          const box = node.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-piece]')?.dataset.piece;
        });
        assert.equal(hit, id, 'Neither stone blocks the other click target');
      }
      assert.equal(await state(), 'seeking');
      await page.locator('.socket[data-piece="u-r"]').click();
      assert.equal(await shared.locator('.socket.filled').count(), 1);
      assert.equal(await piece('u-r').isVisible(), true);
      await page.locator('.socket[data-piece="d-r"]').click();
      assert.equal(await state(), 'empty');
    }
  });

  it('randomly samples action groups first and reaches all 28 valid inventories', async () => {
    assert.deepEqual(await page.evaluate(() => [recipes2.length, recipes3.length]), [12, 16]);
    for (const [button, size, count] of [['next2', 2, 12], ['next3', 3, 16]]) {
      const groups = await page.evaluate(size => {
        const recipes = availableRecipes(size);
        return [...new Set(recipes.map(ids => totalThirds(ids)))].sort((a, b) => a - b)
          .map(charge => recipes.filter(ids => totalThirds(ids) === charge));
      }, size);
      assert.equal(groups.length, size === 2 ? 3 : 5);
      const seen = new Set();
      for (let group = 0; group < groups.length; group++) {
        for (let recipe = 0; recipe < groups[group].length; recipe++) {
          if (await page.locator('#reset').isEnabled()) await page.locator('#reset').click();
          await page.evaluate(values => { let call = 0; Math.random = () => values[call++ % 2]; },
            [(group + .25) / groups.length, (recipe + .25) / groups[group].length]);
          await page.locator(`#${button}`).click();
          assert.equal(await state(), 'balanced');
          assert.deepEqual((await selected()).filter(Boolean), groups[group][recipe]);
          seen.add((await selected()).join(','));
          assert.match(await page.locator('#cycleNote').textContent(), /Случайная/);
          assert.equal(await page.locator('.piece.in-use').count(), size);
          const previous = await selected();
          await page.locator(`#${button}`).click();
          if (groups[group].length > 1) assert.notDeepEqual(await selected(), previous);
          else assert.deepEqual(await selected(), previous, 'A singleton action remains eligible');
        }
      }
      assert.equal(seen.size, count);
    }
    await page.locator('.socket[data-slot="0"]').click();
    assert.equal(await page.locator('#cycleNote').textContent(), '');
    await page.locator('#reset').click();
    assert.equal(await page.locator('.piece:visible').count(), 12);
  });

  it('gives available actions equal random intervals even when ingredients are reserved', async () => {
    for (const reserve of [false, true]) {
      if (reserve) {
        await page.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
        await page.locator('#bindSeal').click();
      }
      for (const count of [2, 3]) {
        const result = await page.evaluate(count => {
          const original = Math.random;
          const charges = [...new Set(availableRecipes(count).map(ids => totalThirds(ids)))].sort((a, b) => a - b);
          const histogram = Object.fromEntries(charges.map(charge => [charge, 0]));
          let valid = true;
          soundEnabled = false;
          try {
            for (let i = 0; i < 60; i++) {
              slots = [null, null, null];
              let call = 0;
              Math.random = () => call++ === 0 ? (i + .5) / 60 : .5;
              randomRecipe(count);
              histogram[totalThirds()]++;
              valid &&= analyzeCombination().valid && slots.filter(Boolean).every(id => !reservedIds().includes(id));
            }
          } finally { Math.random = original; }
          return { histogram, valid, groups: charges.length };
        }, count);
        assert.equal(result.valid, true);
        assert.deepEqual(Object.values(result.histogram), Array(result.groups).fill(60 / result.groups));
        if (reserve && count === 3) assert.equal(result.groups, 4, 'Unavailable dispersion is excluded, not rerolled');
      }
    }
  });

  it('switches visual modes without resetting the model and remembers only the mode', async () => {
    await page.locator('#next3').click();
    const before = await selected();
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.deepEqual(await selected(), before);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'instrument');
    assert.equal(await page.locator('[data-theme-choice="instrument"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('h1').textContent(), 'Цветовой баланс');
    assert.equal(await page.title(), 'Цветовой баланс · QCD');
    assert.equal(await state(), 'balanced');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'instrument');
    assert.equal(await state(), 'empty');
    assert.equal(await page.title(), 'Цветовой баланс · QCD');
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('h1').textContent(), 'Равновесие');
    assert.equal(await page.title(), 'Равновесие · QCD');
  });

  it('can be operated by keyboard, including focus recovery after removal', async () => {
    await piece('u-g').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), ['u-g', null, null]);
    assert.equal(await page.locator('.socket[data-slot="0"]').evaluate(button => document.activeElement === button), true);
    await piece('au-g').focus();
    await page.keyboard.press('Space');
    assert.equal(await state(), 'balanced');
    await page.locator('.socket[data-slot="0"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await piece('u-g').evaluate(button => document.activeElement === button), true);
    assert.equal(await state(), 'seeking');
  });

  it('mutes active audio and does not lose sound after reset', async () => {
    await page.locator('#toggleSound').click();
    await piece('u-r').click();
    assert.equal(await page.evaluate(() => audio), null);
    await page.locator('#toggleSound').click();
    await piece('au-r').click();
    await page.waitForFunction(() => audio?.context.state === 'running');
    assert.equal(await page.evaluate(() => audio.voices.size), 3);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => audio.voices.size), 0);
    await piece('u-b').click();
    assert.equal(await page.evaluate(() => audio.voices.size), 1);
    assert.ok(await page.evaluate(() => audio.master.gain.value > .2));
    await page.locator('#toggleSound').click();
    await page.waitForFunction(() => audio.master.gain.value < .01);
    assert.equal(await page.locator('#toggleSound').getAttribute('aria-pressed'), 'false');
  });

  it('works when browser storage and Web Audio are unavailable', async () => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
      Object.defineProperty(window, 'AudioContext', { value: undefined });
      Object.defineProperty(window, 'webkitAudioContext', { value: undefined });
    });
    await page.reload();
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.locator('#next3').click();
    assert.equal(await state(), 'balanced');
    assert.equal(await page.evaluate(() => audio), null);
  });

  it('sustains scientific tones and reserves consonant chords for valid particles', async () => {
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.evaluate(() => audio), null);
    await piece('u-r').hover();
    assert.equal(await page.evaluate(() => audio), null);
    await piece('u-r').click();
    await page.waitForFunction(() => audio?.context.state === 'running');
    const sound = () => page.evaluate(() => ({ key: audio.stringKey, tones: [...audio.strings].map(voice => Math.round(voice.oscillator.frequency.value * 100) / 100), transients: audio.voices.size }));
    assert.deepEqual(await sound(), { key: 'seeking-1', tones: [146.83, 155.56], transients: 0 });
    assert.equal(await page.evaluate(() => frame), 0, 'Reduced motion does not disable sound');
    await page.evaluate(() => {
      window.soundProbe = audio.context.createAnalyser();
      audio.master.connect(window.soundProbe);
      window.toneStarted = audio.context.currentTime;
    });
    await page.waitForFunction(() => {
      const samples = new Float32Array(window.soundProbe.fftSize);
      window.soundProbe.getFloatTimeDomainData(samples);
      return audio.context.currentTime > window.toneStarted + 1 && samples.some(value => Math.abs(value) > .0001);
    });
    await piece('ad-g').click();
    assert.equal(await page.locator('#chargeValue').textContent(), '+1');
    assert.deepEqual(await sound(), { key: 'seeking-2', tones: [146.83, 155.56], transients: 0 });
    await page.locator('#reset').click();
    assert.deepEqual(await sound(), { key: '', tones: [], transients: 0 });
    for (const [ids, key] of [[['u-r', 'au-r'], 'meson:0'], [['u-r', 'u-g', 'u-b'], 'baryon:2'], [['au-r', 'au-g', 'au-b'], 'antibaryon:-2']]) {
      await page.evaluate(ids => setRecipe(ids), ids);
      const chord = await sound();
      assert.equal(chord.key, key);
      assert.equal(chord.tones.length, 3);
      assert.equal(chord.transients, 0);
    }
    await page.locator('.socket[data-piece="au-b"]').click();
    assert.equal((await sound()).key, 'seeking-2');
    await piece('au-b').click();
    await page.locator('#bindSeal').click();
    assert.deepEqual(await sound(), { key: '', tones: [], transients: 0 });
    await page.waitForFunction(() => {
      const samples = new Float32Array(window.soundProbe.fftSize);
      window.soundProbe.getFloatTimeDomainData(samples);
      return samples.every(value => Math.abs(value) < .00001);
    });
  });

  it('distinguishes scientific chords by particle type and charge, not color permutations', async () => {
    await page.locator('[data-theme-choice="instrument"]').click();
    const recipes = await page.evaluate(() => [...recipes2, ...recipes3]);
    const intervals = { meson: [0, 7, 12], baryon: [0, 4, 7], antibaryon: [0, 3, 7] };
    const signatures = new Map();
    for (const ids of recipes) {
      const chord = await page.evaluate(ids => {
        setRecipe(ids);
        return { kind: analyzeCombination().kind, charge: totalThirds() / 3, key: audio.stringKey,
          notes: [...audio.strings].map(voice => voice.oscillator.frequency.value) };
      }, ids);
      assert.equal(chord.key, `${chord.kind}:${chord.charge}`);
      assert.equal(chord.notes.length, 3);
      assert.ok(Math.abs(12 * Math.log2(chord.notes[0] / 146.83) - chord.charge * 2) < .00001);
      chord.notes.forEach((frequency, index) => {
        assert.ok(Math.abs(12 * Math.log2(frequency / chord.notes[0]) - intervals[chord.kind][index]) < .00001);
      });
      const signature = chord.notes.map(frequency => frequency.toFixed(2)).join(',');
      if (signatures.has(chord.key)) assert.equal(signature, signatures.get(chord.key));
      signatures.set(chord.key, signature);
    }
    assert.equal(signatures.size, 11);
    assert.equal(new Set(signatures.values()).size, 11);
    const reused = await page.evaluate(() => {
      setRecipe(['u-r', 'ad-r']);
      const voices = [...audio.strings];
      setRecipe(['ad-b', 'u-b']);
      return voices.every(voice => audio.strings.has(voice));
    });
    assert.equal(reused, true, 'Equivalent color arrangements keep the same sustained voices');
  });

  it('silences scientific tones on mute, theme changes, and hidden tabs and restarts them safely', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.locator('#toggleSound').click();
    await piece('u-r').click();
    assert.equal(await page.evaluate(() => audio), null);
    await page.locator('#toggleSound').click();
    await page.waitForFunction(() => audio?.context.state === 'running');
    assert.equal(await page.evaluate(() => audio.strings.size), 2);
    await page.evaluate(() => {
      window.muteProbe = audio.context.createAnalyser();
      audio.master.connect(window.muteProbe);
    });
    await page.locator('#toggleSound').click();
    assert.equal(await page.evaluate(() => audio.strings.size), 0);
    await page.waitForFunction(() => {
      const samples = new Float32Array(window.muteProbe.fftSize);
      window.muteProbe.getFloatTimeDomainData(samples);
      return samples.every(value => Math.abs(value) < .00001);
    }, null, { timeout: 3000 });
    assert.ok(await page.evaluate(() => frame > 0), 'Muting does not stop visible vibration');
    await page.locator('#toggleSound').click();
    assert.equal(await page.evaluate(() => audio.strings.size), 2);
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.evaluate(() => audio.strings.size), 0);
    await piece('au-r').click();
    assert.equal(await page.evaluate(() => audio.voices.size), 3, 'Alchemy retains its transient chime');
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.evaluate(() => audio.voices.size), 0);
    assert.equal(await page.evaluate(() => audio.strings.size), 3);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => audio.context.state === 'suspended');
    assert.equal(await page.evaluate(() => audio.strings.size), 0);
    assert.equal(await page.evaluate(() => frame), 0);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => audio.context.state === 'running');
    assert.equal(await page.evaluate(() => audio.strings.size), 3);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => audio.strings.size), 0);
    assert.equal(await page.evaluate(() => frame), 0);
  });

  it('stops the animation loop in the empty state and honors live motion preference changes', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => frame === 0);
    await page.locator('#next3').click();
    assert.ok(await page.evaluate(() => frame > 0));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => frame === 0);
    assert.equal(await page.locator('#focus').getAttribute('transform'), 'translate(320 294)');
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => frame), 0);
  });
});

describe('Seals and reserved inventory', () => {
  it('maps all 28 recipes to five large and three small symbols, only when balanced', async () => {
    assert.equal(await page.locator('#bindSeal').isVisible(), false);
    const variants = new Set();
    const recipes = await page.evaluate(() => [...recipes2, ...recipes3]);
    const names = ['Сжатие', 'Притяжение', 'Удержание', 'Отталкивание', 'Рассеивание'];
    const sealNames = ['сжатия', 'притяжения', 'удержания', 'отталкивания', 'рассеивания'];
    for (const ids of recipes) {
      const q = await page.evaluate(ids => { setRecipe(ids); return totalThirds() / 3; }, ids);
      const expected = ids.length === 2 ? `Малое ${names[q + 2].toLowerCase()}` : names[q + 2];
      assert.equal(await page.locator('#abilityName').textContent(), `${ids.length === 2 ? 'Малая печать' : 'Печать'} ${sealNames[q + 2]}`);
      assert.equal(await page.locator('#resultTitle').textContent(), expected);
      assert.equal(await page.locator('#actionSteps [aria-current="true"] .action-name').textContent(), names[q + 2]);
      assert.equal(await page.locator('#actionMarker').evaluate(node => node.style.top), `${(q + 2) * 25}%`);
      assert.equal(await page.locator('#bindSeal').isVisible(), true);
      const icon = page.locator('#alchemySeal .seal-icon');
      const key = `${await icon.getAttribute('data-size')}:${await icon.getAttribute('data-action')}`;
      for (const root of ['#alchemySeal', '#abilityPreview']) {
        assert.equal(await page.locator(`${root} .seal-object`).count(), 1);
        assert.equal(await page.locator(`${root} .seal-object`).getAttribute('d'), 'M0-6 6 0 0 6-6 0Z');
        assert.equal(await page.locator(`${root} .seal-symbol circle`).getAttribute('r'), '2');
      }
      if (!variants.has(key)) await page.locator('#abilityPreview').screenshot({ path: path.join(artifacts, `seal-object-${key.replace(':', '-')}.png`) });
      variants.add(key);
      assert.equal(await icon.isVisible(), true);
      assert.equal(await page.locator('#chargeValue').isVisible(), false);
    }
    assert.equal(variants.size, 8);
    assert.equal([...variants].filter(key => key.startsWith('small:')).length, 3);
    await page.evaluate(() => setRecipe(['u-r', 'ad-g']));
    assert.equal(await page.locator('#chargeValue').textContent(), '+1');
    assert.equal(await page.locator('#bindSeal').isVisible(), false);
    assert.equal(await page.locator('#abilityName').textContent(), 'Печать не собрана');
    assert.equal(await page.locator('#alchemySeal [data-action]').count(), 0);
    await page.evaluate(() => bindSeal());
    assert.equal(await page.locator('.ability-slot.filled').count(), 0);
  });

  it('reserves the exact stones, guards every insertion path, and returns only the released set', async () => {
    await piece('u-r').click();
    await piece('ad-r').click();
    await page.locator('#bindSeal').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), [null, null, null]);
    assert.equal(await page.locator('.ability-slot').count(), 6);
    assert.equal(await page.locator('.ability-label').textContent(), 'Малое отталкивание');
    assert.equal(await page.locator('#inventoryCount').textContent(), '10 / 12');
    assert.equal(await piece('u-r').isVisible(), false);
    assert.equal(await socketTarget('u-r').isDisabled(), true);
    assert.equal(await socketTarget('d-r').isEnabled(), true);
    await page.evaluate(() => { addPiece('u-r'); setRecipe(['u-r', 'au-r']); bindSeal(); });
    assert.deepEqual(await selected(), [null, null, null]);
    assert.equal(await page.locator('.ability-slot.filled').count(), 1);
    await piece('u-g').click();
    await page.locator('#reset').click();
    assert.equal(await page.locator('#inventoryCount').textContent(), '10 / 12');
    await piece('u-g').click();
    await page.locator('[data-release="0"]').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), ['u-g', null, null]);
    assert.equal(await page.locator('#inventoryCount').textContent(), '11 / 12');
    assert.equal(await piece('u-r').isVisible(), true);
    assert.equal(await socketTarget('u-r').isEnabled(), true);
    assert.equal(await page.locator('.ability-slot.empty').count(), 6);
  });
});

describe('Ability panel combinations', () => {
  it('releases all saved compositions in either mode without clearing the current circle', async () => {
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      assert.equal(await page.locator('#releaseAll').isDisabled(), true);
      assert.equal(await page.locator('#releaseAll').textContent(), theme === 'artifact' ? 'Разобрать все способности' : 'Разобрать все частицы');
      for (const ids of [['u-r', 'au-r'], ['u-g', 'au-g']]) {
        await page.evaluate(ids => setRecipe(ids), ids);
        await page.locator('#bindSeal').click();
      }
      await piece('u-b').click();
      assert.equal(await page.locator('#releaseAll').isEnabled(), true);
      await page.locator('#releaseAll').click();
      assert.deepEqual(await selected(), ['u-b', null, null]);
      assert.deepEqual(await page.evaluate(() => abilities), Array(6).fill(null));
      assert.equal(await page.locator('.inventory-cell.reserved').count(), 0);
      assert.equal(await page.locator('.piece:visible').count(), 11);
      assert.equal(await page.locator('#abilityCount').textContent(), '0 / 6');
      assert.equal(await page.locator('#releaseAll').isDisabled(), true);
      assert.equal(await piece('u-r').evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#preview').isVisible(), false);
      await page.locator('#reset').click();
      assert.equal(await page.locator('.piece:visible').count(), 12);
    }
  });

  it('holds six identical small abilities, preserves gaps, and fits both themes on mobile', async () => {
    for (const color of ['r', 'g', 'b']) {
      for (const flavor of ['u', 'd']) {
        await page.evaluate(ids => setRecipe(ids), [`${flavor}-${color}`, `a${flavor}-${color}`]);
        await page.locator('#bindSeal').click();
      }
    }
    assert.deepEqual(await page.locator('.ability-label').allTextContents(), Array(6).fill('Малое удержание'));
    assert.equal(await page.locator('#inventoryCount').textContent(), '0 / 12');
    assert.equal(await page.locator('#abilityCount').textContent(), '6 / 6');
    assert.equal(await page.locator('.socket-target:enabled').count(), 0);
    assert.equal(await page.locator('#next2').isDisabled(), true);
    assert.equal(await page.locator('#next3').isDisabled(), true);
    assert.equal(await page.locator('.inventory-cell.reserved').count(), 12);
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        assert.equal(await page.locator('.ability-slot.filled').count(), 6);
        assert.equal(await page.locator('.ability-size').count(), 0);
        assert.doesNotMatch(await page.locator('#abilityBar').innerText(), /руны|компонента/);
        assert.equal(await page.locator('.colophon').textContent(), theme === 'artifact' ? 'QCD / 01 · АЛХИМИЯ' : 'QCD / 02 · КВАРКОВАЯ МОДЕЛЬ');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const cards = await page.locator('.ability-slot').evaluateAll(nodes => nodes.map(node => {
          const label = node.querySelector('.ability-label').getBoundingClientRect();
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            fits: label.left >= box.left && label.right <= box.right && label.bottom <= box.bottom,
            width: parseFloat(style.width), height: parseFloat(style.height),
            icon: parseFloat(getComputedStyle(node.querySelector('.seal-icon')).width),
            gap: parseFloat(getComputedStyle(node.querySelector('.ability-label')).marginTop)
          };
        }));
        assert.ok(cards.every(card => card.fits), `Labels must fit at ${width}px in ${theme}`);
        assert.ok(cards.every(card => card.width <= 128.1 && card.height < 130), 'Slots stay compact instead of stretching across the page');
        const panel = await page.locator('.abilities').boundingBox();
        const workbench = await page.locator('.workbench').boundingBox();
        assert.ok(Math.abs(panel.x + panel.width / 2 - workbench.x - workbench.width / 2) < 1, 'The compact panel is centered within the page');
        assert.ok(cards.every(card => card.icon === (width <= 680 ? 62 : 72) && card.gap === 2), 'Icons retain their size with tighter label spacing');
        if (width === 1440 || width === 390) await page.locator('.abilities').screenshot({ path: path.join(artifacts, `compact-panel-${theme}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.screenshot({ path: path.join(artifacts, 'abilities-mobile-six.png'), fullPage: true });
    await page.locator('[data-release="2"]').click();
    assert.equal(await page.locator('#abilityBar > li').nth(2).getAttribute('class'), 'ability-slot empty');
    assert.deepEqual(await page.evaluate(() => abilities[3]), ['d-g', 'ad-g']);
    assert.equal(await page.locator('#next2').isEnabled(), true);
    assert.equal(await page.locator('#next3').isDisabled(), true);
    await page.locator('#next2').click();
    await page.locator('#next2').click();
    assert.deepEqual((await selected()).filter(Boolean).sort(), ['au-g', 'u-g']);
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('.ability-slot.filled').count(), 6);
  });

  it('builds both extremes and three small holding seals without sharing stones', async () => {
    const recipes = [['u-r', 'u-g', 'u-b'], ['au-r', 'au-g', 'au-b'], ['d-r', 'ad-r'], ['d-g', 'ad-g'], ['d-b', 'ad-b']];
    for (const ids of recipes) {
      await page.evaluate(ids => setRecipe(ids), ids);
      await page.locator('#bindSeal').click();
    }
    assert.deepEqual(await page.locator('.ability-label').allTextContents(), ['Рассеивание', 'Сжатие', 'Малое удержание', 'Малое удержание', 'Малое удержание']);
    assert.equal(await page.evaluate(() => new Set(reservedIds()).size), 12);
    assert.equal(await page.locator('#next2').isDisabled(), true);
    await page.screenshot({ path: path.join(artifacts, 'abilities-mixed-desktop.png'), fullPage: true });
  });
});

describe('Ability modes and descriptions', () => {
  it('uses distinct approved descriptions for all eight seals in the readout and saved tooltips', async () => {
    const cases = [
      [['au-r', 'au-g', 'au-b'], 'Спрессовывает вещество в плотный сгусток.'],
      [['au-r', 'au-g', 'ad-b'], 'Резко тянет выбранный предмет к тебе.'],
      [['u-r', 'd-g', 'd-b'], 'Обездвиживает выбранный предмет, фиксируя его на месте.'],
      [['u-r', 'u-g', 'd-b'], 'Отбрасывает выбранный предмет от тебя.'],
      [['u-r', 'u-g', 'u-b'], 'Разрушает цельную форму предмета, рассеивая его вещество вокруг.'],
      [['d-r', 'au-r'], 'Слабо притягивает выбранный предмет к тебе.'],
      [['u-r', 'au-r'], 'Сдерживает движение выбранного предмета.'],
      [['u-r', 'ad-r'], 'Слабо отталкивает выбранный предмет от тебя.']
    ];
    for (const [ids, detail] of cases) {
      await page.evaluate(ids => setRecipe(ids), ids);
      assert.equal(await page.locator('#abilityDetail').textContent(), detail);
      await page.locator('#bindSeal').click();
      await page.locator('.ability-card').click();
      assert.equal((await page.locator('#runeTooltip').textContent()).split('\n')[1], detail);
      await page.locator('[data-theme-choice="instrument"]').click();
      await page.locator('.ability-card').click();
      assert.equal((await page.locator('#runeTooltip').textContent()).includes(detail), false);
      await page.locator('[data-theme-choice="artifact"]').click();
      await page.locator('.ability-card').click();
      assert.equal((await page.locator('#runeTooltip').textContent()).split('\n')[1], detail);
      await page.locator('#releaseAll').click();
    }
  });

  it('keeps reservations across mode switches and filters all random recipe choices', async () => {
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
    await page.locator('#bindSeal').click();
    for (const count of [2, 3]) {
      const candidates = await page.evaluate(count => availableRecipes(count), count);
      assert.ok(candidates.length > 0);
      for (let i = 0; i < candidates.length; i++) {
        await page.evaluate(({ count, i, length }) => {
          slots = [null, null, null];
          Math.random = () => (i + .25) / length;
          randomRecipe(count);
        }, { count, i, length: candidates.length });
        const ids = (await selected()).filter(Boolean);
        assert.equal(ids.length, count);
        assert.ok(ids.every(id => !['u-r', 'u-g', 'u-b'].includes(id)));
      }
    }
    const before = await page.evaluate(() => ({ slots, abilities }));
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.deepEqual(await page.evaluate(() => ({ slots, abilities })), before);
    assert.equal(await page.locator('#chargeValue').isVisible(), true);
    assert.equal(await page.locator('#abilityName').isVisible(), false);
    assert.equal(await page.locator('#alchemySeal').isVisible(), false);
    assert.equal(await page.locator('#resultSeal').isVisible(), true);
    assert.equal(await page.locator('#abilitiesTitle').textContent(), 'Частицы');
    assert.equal(await page.locator('.ability-label').textContent(), 'Барион · +2 e');
    await page.screenshot({ path: path.join(artifacts, 'abilities-instrument-desktop.png'), fullPage: true });
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.deepEqual(await page.evaluate(() => ({ slots, abilities })), before);
    assert.equal(await page.locator('.ability-label').textContent(), 'Рассеивание');
    await page.reload();
    assert.equal(await page.locator('.ability-slot.filled').count(), 0, 'Only the theme persists across reloads');
    assert.equal(await page.locator('#inventoryCount').textContent(), '12 / 12');
  });

  it('explains runes on hover and keyboard focus and saved ingredients on inspection', async () => {
    const tooltip = page.locator('#runeTooltip');
    await piece('d-r').hover();
    assert.match(await tooltip.textContent(), /^Малый камень ♂\n/);
    assert.match(await tooltip.textContent(), /Марса.*К себе: 1\/3/s);
    assert.equal(await tooltip.isVisible(), true);
    assert.deepEqual(await selected(), [null, null, null]);
    await tooltip.hover();
    await page.waitForTimeout(300);
    assert.equal(await tooltip.isVisible(), true, 'The description remains available while hovered');
    await page.keyboard.press('Escape');
    assert.equal(await tooltip.isVisible(), false);
    await piece('u-b').hover();
    assert.match(await tooltip.textContent(), /^Большой камень ☾\n/);
    assert.match(await tooltip.textContent(), /Прямой знак Луны/);
    await piece('au-b').hover();
    assert.match(await tooltip.textContent(), /Обратный знак Луны/);
    await piece('u-g').focus();
    assert.match(await tooltip.textContent(), /Венеры.*От себя: 2\/3/s);
    assert.equal(await piece('u-g').getAttribute('aria-describedby'), 'runeTooltip');
    await page.keyboard.press('Enter');
    assert.deepEqual(await selected(), ['u-g', null, null]);
    await page.locator('[data-theme-choice="instrument"]').click();
    await piece('au-r').hover();
    assert.match(await tooltip.textContent(), /Антикрасный u-антикварк, заряд −2\/3 e/s);
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.evaluate(() => setRecipe(['u-g', 'au-g']));
    await page.locator('#bindSeal').click();
    await page.locator('[data-ability="0"]').click();
    assert.match(await tooltip.textContent(), /Малая печать удержания.*Состав:.*От себя: 2\/3.*К себе: 2\/3/s);
    await page.locator('[data-inspect="u-g"]').hover();
    assert.match(await tooltip.textContent(), /В закреплённом составе/);
    await page.keyboard.press('Escape');
    assert.equal(await tooltip.isVisible(), false);
  });
});

describe('Seal presentation and focus', () => {
  it('covers incoming strands with an opaque seal backplate below the glow and central symbol', async () => {
    const backplate = page.locator('#sealBackplate');
    assert.equal(await backplate.isVisible(), false);
    for (const ids of [['u-r', 'ad-r'], ['u-r', 'u-g', 'd-b']]) {
      await page.evaluate(ids => setRecipe(ids), ids);
      const layers = await page.evaluate(() => {
        const plate = $('sealBackplate');
        const style = getComputedStyle(plate);
        const follows = (before, after) => !!(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { opaque: style.opacity === '1' && style.fillOpacity === '1' && style.fill === getComputedStyle(document.body).backgroundColor,
          ordered: follows($('strands'), plate) && follows(plate, document.querySelector('.target-light')) && follows(document.querySelector('.target-light'), $('alchemySeal')),
          radius: plate.getAttribute('r'), rim: $('alchemySeal').querySelector('.seal-rim').getAttribute('r') };
      });
      assert.equal(await backplate.isVisible(), true);
      assert.ok(layers.opaque && layers.ordered, 'The solid surface hides strands while allowing the glow above it');
      assert.equal(layers.radius, layers.rim);
      assert.equal(await page.locator('#abilityPreview .seal-backplate').count(), 0);
      await page.locator('#chamber').screenshot({ path: path.join(artifacts, `opaque-seal-${ids.length}.png`) });
      await page.locator('[data-theme-choice="instrument"]').click();
      assert.equal(await backplate.isVisible(), false);
      await page.locator('[data-theme-choice="artifact"]').click();
      assert.equal(await backplate.isVisible(), true);
      await page.evaluate(() => removePiece(0));
      assert.equal(await backplate.isVisible(), false);
    }
  });

  it('gives direct and reverse stones equal glow while keeping ghost sockets and scientific glyphs unlit', async () => {
    for (const color of ['r', 'g', 'b']) {
      for (const flavor of ['u', 'd']) {
        const filter = id => piece(id).locator('.rune-glyph').evaluate(node => getComputedStyle(node).filter);
        assert.match(await filter(`${flavor}-${color}`), /drop-shadow/);
        assert.equal(await filter(`${flavor}-${color}`), await filter(`a${flavor}-${color}`));
      }
    }
    const ghosts = await page.locator('.socket-ghost .rune-glyph').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).filter));
    assert.ok(ghosts.length > 0 && ghosts.every(filter => filter === 'none'));
    await page.evaluate(() => setRecipe(['u-r', 'au-r']));
    const occupied = await page.locator('.socket.filled .rune-glyph').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).filter));
    assert.match(occupied[0], /drop-shadow/);
    assert.equal(occupied[0], occupied[1]);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.ok(await page.locator('.rune-glyph').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).filter === 'none')));
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.locator('#reset').click();
    await page.locator('#palette').screenshot({ path: path.join(artifacts, 'equal-planetary-glow.png') });
  });

  it('centers one directional arrow and the shared diamond object in both seal sizes', async () => {
    const cases = [
      ['attraction', ['d-r', 'au-r'], 'M72 50H44M52 42 44 50 52 58'],
      ['attraction', ['au-r', 'au-g', 'ad-b'], 'M72 50H44M52 42 44 50 52 58'],
      ['repulsion', ['u-r', 'ad-r'], 'M44 50H72M64 42 72 50 64 58'],
      ['repulsion', ['u-r', 'u-g', 'd-b'], 'M44 50H72M64 42 72 50 64 58']
    ];
    for (const [action, ids, shape] of cases) {
      await page.evaluate(ids => setRecipe(ids), ids);
      for (const root of ['#alchemySeal', '#abilityPreview']) {
        const symbol = page.locator(`${root} .seal-symbol`);
        assert.equal(await symbol.locator('.seal-action').getAttribute('d'), shape);
        assert.equal(await symbol.locator('.seal-object').getAttribute('transform'), 'translate(34 50)');
        assert.equal(await symbol.locator('circle').getAttribute('cx'), '34');
        assert.deepEqual(await symbol.evaluate(node => {
          const box = node.getBBox();
          return [box.x + box.width / 2, box.y + box.height / 2];
        }), [50, 50]);
      }
      if (ids.length === 3) await page.screenshot({ path: path.join(artifacts, `${action}-directional-seal.png`), fullPage: true });
      await page.locator('#bindSeal').click();
      assert.equal(await page.locator('.ability-card .seal-action').getAttribute('d'), shape);
      assert.equal(await page.locator('.ability-card .seal-object').getAttribute('d'), 'M0-6 6 0 0 6-6 0Z');
      assert.equal(await page.locator('.ability-card .seal-symbol circle').getAttribute('cx'), '34');
      await page.locator('#releaseAll').click();
    }
  });

  it('centers a bounded seal on the target at every viewport size and retains the release animation', async () => {
    const targetOpacity = () => page.locator('#centerTarget').evaluate(node => Number(getComputedStyle(node).opacity));
    assert.ok(await targetOpacity() > 0);
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
    assert.equal(await targetOpacity(), 0);
    assert.equal(await page.locator('#focus').evaluate(node => getComputedStyle(node).opacity), '0');
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.evaluate(() => {
        const field = document.querySelector('#field').getBoundingClientRect();
        const seal = document.querySelector('#alchemySeal .seal-rim').getBoundingClientRect();
        const center = document.querySelector('#centerTarget').getBoundingClientRect();
        return { dx: seal.x + seal.width / 2 - center.x - center.width / 2, dy: seal.y + seal.height / 2 - center.y - center.height / 2, scale: seal.width / field.width };
      });
      assert.ok(Math.abs(geometry.dx) < 1 && Math.abs(geometry.dy) < 1, `Centered at ${width}px`);
      assert.ok(Math.abs(geometry.scale - 80 / 640) < .001, 'The 80-unit seal rim retains its scale inside the field');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(artifacts, 'seal-unobstructed-dispersion.png'), fullPage: true });
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.ok(await targetOpacity() > 0, 'The scientific target remains visible');
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await targetOpacity(), 0);
    await page.locator('.socket[data-piece="u-b"]').click();
    assert.ok(await targetOpacity() > 0, 'The target returns for an incomplete seal');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => setRecipe(['d-r', 'ad-r']));
    assert.equal(await page.locator('.release-ring').evaluate(node => getComputedStyle(node).animationName), 'release');
    assert.equal(await page.locator('#alchemySeal .seal-icon').evaluate(node => getComputedStyle(node).animationName), 'seal-imprint');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#alchemySeal .seal-icon').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.screenshot({ path: path.join(artifacts, 'seal-completed-desktop.png'), fullPage: true });
    assert.equal(await targetOpacity(), 0);
    await page.locator('#reset').click();
    assert.ok(await targetOpacity() > 0, 'The empty circle retains its target');
  });

  it('brings keyboard focus into view when binding and releasing across mobile sections', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => setRecipe(['u-r', 'au-r']));
    await page.locator('#bindSeal').focus();
    await page.keyboard.press('Enter');
    const focusVisible = () => page.evaluate(() => {
      const box = document.activeElement.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    });
    assert.equal(await page.locator('[data-ability="0"]').evaluate(node => document.activeElement === node), true);
    assert.equal(await focusVisible(), true);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(await piece('u-r').evaluate(node => document.activeElement === node), true);
    assert.equal(await focusVisible(), true);
  });
});

describe('Focus synchronization regressions', () => {
  it('appears at the first contribution without a path from the empty center and moves only between existing positions', async () => {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await page.evaluate(() => { abilities.fill(null); slots = [null, null, null]; render(); });
        await piece('u-r').hover();
        assert.equal(await page.locator('#previewDot').isVisible(), true);
        assert.equal(await page.locator('#previewPath').getAttribute('d'), '');
        assert.equal(await page.locator('#previewRing').isVisible(), false);
        const first = await page.evaluate(() => {
          const preview = { x: Number($('previewDot').getAttribute('cx')), y: Number($('previewDot').getAttribute('cy')) };
          addPiece('u-r');
          const position = currentPosition(performance.now());
          const transform = $('focus').transform.baseVal.consolidate().matrix;
          return { preview, from: motion.from, target: motion.target, moving: position.moving, drawn: { x: transform.e, y: transform.f } };
        });
        assert.deepEqual(first.from, first.target);
        assert.deepEqual(first.drawn, first.preview);
        assert.equal(first.moving, false, `${theme}/${reducedMotion}: first point does not fly out of the center`);
        const appearance = await page.evaluate(() => {
          const node = $('focus');
          const animation = node.getAnimations().find(animation => animation.animationName === 'focus-appear');
          if (!animation) return { animated: false, opacity: getComputedStyle(node).opacity };
          const savedTime = animation.currentTime;
          animation.pause();
          const samples = [0, 150, 300].map(time => {
            animation.currentTime = time;
            return { opacity: Number(getComputedStyle(node).opacity), position: node.getAttribute('transform') };
          });
          animation.currentTime = savedTime;
          animation.play();
          return { animated: true, samples };
        });
        assert.equal(appearance.animated, reducedMotion === 'no-preference');
        if (appearance.animated) {
          assert.equal(appearance.samples[0].opacity, 0);
          assert.ok(appearance.samples[1].opacity > 0 && appearance.samples[1].opacity < 1);
          assert.equal(appearance.samples[2].opacity, 1);
          assert.equal(new Set(appearance.samples.map(sample => sample.position)).size, 1, 'Appearance changes opacity, not position');
        } else assert.equal(appearance.opacity, '1');
        await piece('u-g').hover();
        assert.match(await page.locator('#previewPath').getAttribute('d'), /^M.+L/);
        const second = await page.evaluate(() => {
          addPiece('u-g');
          return { from: motion.from, target: motion.target, moving: currentPosition(performance.now()).moving };
        });
        assert.equal(second.from.x, first.target.x);
        assert.equal(second.from.y, first.target.y);
        assert.notDeepEqual(second.target, first.target);
        assert.equal(second.moving, reducedMotion === 'no-preference');
        await page.waitForFunction(() => !currentPosition(performance.now()).moving);
        const removalMoves = await page.evaluate(() => { removePiece(1); return currentPosition(performance.now()).moving; });
        assert.equal(removalMoves, reducedMotion === 'no-preference', 'Removing the second stone still moves the existing point');
        await page.evaluate(() => removePiece(0));
        await socketTarget('au-b').focus();
        assert.equal(await page.locator('#previewPath').getAttribute('d'), '');
        assert.equal(await page.evaluate(() => { addPiece('au-b'); return currentPosition(performance.now()).moving; }), false);
        await page.locator('#reset').click();
        await page.evaluate(() => { setRecipe(['u-r', 'ad-r']); bindSeal(); });
        await piece('d-b').hover();
        assert.equal(await page.locator('#previewPath').getAttribute('d'), '');
        assert.equal(await page.evaluate(() => { addPiece('d-b'); return currentPosition(performance.now()).moving; }), false, 'Binding also returns to an absent focus');
      }
    }
  });

  it('vibrates occupied scientific strings without moving their endpoints or animating an empty circle', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.evaluate(() => frame), 0);
    await piece('u-r').click();
    await page.waitForFunction(() => !currentPosition(performance.now()).moving);
    const strand = page.locator('#strands .strand:not(.strand-glow)');
    const first = await strand.getAttribute('d');
    assert.equal((first.match(/L/g) || []).length, 12);
    await page.waitForFunction(first => document.querySelector('#strands .strand:not(.strand-glow)').getAttribute('d') !== first, first);
    const errors = await page.evaluate(() => strandElements.map(({ element, anchor }) => {
      const start = element.getPointAtLength(0);
      const end = element.getPointAtLength(element.getTotalLength());
      return [Math.hypot(start.x - anchor.x, start.y - anchor.y), Math.hypot(end.x - motion.target.x, end.y - motion.target.y)];
    }));
    assert.ok(errors.flat().every(error => error < .001));
    await page.locator('#field').screenshot({ path: path.join(artifacts, 'scientific-vibrating-string.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => frame === 0);
    assert.equal(await strand.evaluate(node => {
      const start = node.getPointAtLength(0);
      const end = node.getPointAtLength(node.getTotalLength());
      return Math.abs(node.getTotalLength() - Math.hypot(end.x - start.x, end.y - start.y)) < .001;
    }), true, 'Reduced-motion strings remain straight');
    assert.equal(await page.evaluate(() => audio.strings.size), 2);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => frame > 0);
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.waitForFunction(() => frame === 0);
    assert.match(await strand.getAttribute('d'), /Q/);
    await page.locator('#reset').click();
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.evaluate(() => frame), 0);
    assert.equal(await page.locator('#strands path').count(), 0);
  });

  it('joins every ready strand and the focus at the seal immediately, including scaled layouts', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [width, height] of [[390, 844], [1440, 1000], [1920, 1440]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await page.evaluate(() => { abilities.fill(null); slots = [null, null, null]; render(); setRecipe(['u-r', 'u-g']); });
        await page.waitForFunction(() => !currentPosition(performance.now()).moving);
        const geometry = await page.evaluate(() => {
          addPiece('u-b');
          const position = (node, point) => new DOMPoint(point.x, point.y).matrixTransform(node.getScreenCTM());
          const target = position(document.querySelector('#centerTarget'), center);
          const focus = position(document.querySelector('#focus'), { x: 0, y: 0 });
          return {
            focusError: Math.hypot(focus.x - target.x, focus.y - target.y),
            ends: strandElements.map(({ element }) => {
              const end = position(element, element.getPointAtLength(element.getTotalLength()));
              return Math.hypot(end.x - target.x, end.y - target.y);
            }),
            starts: strandElements.filter(({ glow }) => !glow).map(({ element }, index) => {
              const start = position(element, element.getPointAtLength(0));
              const box = document.querySelector(`[data-piece="${slots[index]}"] .socket-face`).getBoundingClientRect();
              return Math.hypot(start.x - box.x - box.width / 2, start.y - box.y - box.height / 2);
            })
          };
        });
        assert.ok(geometry.focusError < .01, `Ready focus is centered immediately: ${theme}, ${width}`);
        assert.ok(geometry.ends.every(error => error < .02));
        assert.ok(geometry.starts.every(error => error < 1));
        await page.evaluate(() => { bindSeal(); setRecipe(['d-r', 'ad-r']); bindSeal(); });
        assert.equal(await page.locator('#focus').evaluate(node => getComputedStyle(node).opacity), '0');
        assert.equal(await page.locator('#bindSeal').isVisible(), false);
        await page.evaluate(() => addPiece('au-b'));
        await page.waitForFunction(() => !currentPosition(performance.now()).moving);
        const unbalanced = await page.evaluate(() => ({ target: motion.target, current: currentPosition(performance.now()), reserved: abilities.filter(Boolean).length }));
        assert.equal(unbalanced.reserved, 2);
        assert.ok(unbalanced.current.x < 320 && unbalanced.current.y < 294, 'An anti-blue quark shifts focus upper-left, independently of saved seals');
        assert.ok(Math.hypot(unbalanced.current.x - 320, unbalanced.current.y - 294) > 50);
        assert.equal(await page.locator('#alchemySeal [data-action]').count(), 0);
        assert.equal(await page.locator('#bindSeal').isVisible(), false);
        if (width === 1920) await page.screenshot({ path: path.join(artifacts, `focus-corrected-${theme}.png`), fullPage: true });
      }
    }
  });
});

describe('Scientific vocabulary and particle examples', () => {
  it('switches between an alchemical emblem and a three-quark emblem without changing the assembly', async () => {
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'd-b']));
    const brand = await page.locator('.brand-mark').boundingBox();
    assert.equal(await page.locator('.brand-artifact').isVisible(), true);
    assert.equal(await page.locator('.brand-instrument').isVisible(), false);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('.brand-artifact').isVisible(), false);
    assert.equal(await page.locator('.brand-instrument').isVisible(), true);
    assert.equal(await page.locator('.brand-instrument .quark').count(), 3);
    assert.equal(await page.locator('.brand-instrument > *').count(), 3, 'Only the three colored circles remain');
    assert.equal(await page.locator('#field .triangle:visible').count(), 0);
    const fills = await page.locator('.brand-instrument .quark').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
    assert.equal(new Set(fills).size, 3);
    const scientificBrand = await page.locator('.brand-mark').boundingBox();
    assert.equal(scientificBrand.width, brand.width);
    assert.equal(scientificBrand.height, brand.height);
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('.brand-artifact').isVisible(), true);
    assert.equal(await page.locator('#field .triangle:visible').count(), 2);
    assert.deepEqual(await selected(), ['u-r', 'u-g', 'd-b']);
  });

  it('shows assembled scientific states above charge and clears stale names', async () => {
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#stateName').isVisible(), false);
    await piece('u-r').click();
    assert.equal(await page.locator('#stateName').isVisible(), false);
    for (const [ids, name] of [
      [['u-r', 'ad-r'], 'Мезон'],
      [['u-r', 'u-g', 'd-b'], 'Барион'],
      [['au-r', 'au-g', 'ad-b'], 'Антибарион']
    ]) {
      await page.evaluate(ids => setRecipe(ids), ids);
      assert.equal(await page.locator('#stateName').textContent(), name);
      assert.equal(await page.locator('#stateName').isVisible(), true);
      const heading = await page.locator('#stateName').boundingBox();
      const charge = await page.locator('#chargeTitle').boundingBox();
      assert.ok(heading.y + heading.height <= charge.y);
    }
    await page.screenshot({ path: path.join(artifacts, 'scientific-state-heading.png'), fullPage: true });
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('#stateName').isVisible(), false);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#stateName').textContent(), 'Антибарион');
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('#stateName').isVisible(), false);
    assert.equal(await page.locator('#stateName').textContent(), '');
    await page.locator('#releaseAll').click();
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'd-r']));
    assert.equal(await page.locator('#stateName').isVisible(), false, 'Integer charge with unbalanced color is not a state');
  });

  it('keeps alchemy uncluttered and uses scientific labels throughout the other theme', async () => {
    assert.equal(await page.locator('#resultTitle').textContent(), 'Помести камень на алхимический круг');
    assert.equal(await page.locator('#libraryNote').textContent(), 'Нажми на камень, чтобы добавить его в круг.');
    assert.equal(await page.locator('.family-symbol:visible').count(), 3);
    assert.deepEqual(await page.locator('.family-symbol path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d'))),
      await page.evaluate(() => colors.map(color => families[color].path)));
    assert.doesNotMatch(await page.locator('.palette').innerText(), /I/);
    assert.equal(await page.locator('#balanceValue').isVisible(), false);
    assert.equal(await page.locator('#balanceTitle').isVisible(), false);
    assert.equal(await page.locator('.palette-labels').isVisible(), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /Разные знаки|Общий центр/);
    await piece('d-r').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Малый камень.*К себе: 1\/3/s);
    await piece('u-g').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /От себя: 2\/3/);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#libraryTitle').textContent(), 'Кварки и антикварки');
    assert.equal(await page.locator('#forwardLabel').textContent(), 'Кварки');
    assert.equal(await page.locator('#reverseLabel').textContent(), 'Антикварки');
    assert.equal(await page.locator('.family-symbol:visible').count(), 0);
    assert.deepEqual(await page.locator('.family-head .instrument-only:visible').allTextContents(), ['r', 'g', 'b']);
    assert.equal(await page.locator('.palette-labels').isVisible(), true);
    assert.equal(await page.locator('#slotCount').textContent(), 'Компоненты: 0 / 3');
    assert.equal(await page.locator('#balanceValue').textContent(), 'Нет кварков');
    assert.equal(await page.locator('#fieldLabel').textContent(), 'Цветовая диаграмма');
    assert.equal(await page.locator('#resultTitle').textContent(), 'Состав не выбран');
    assert.doesNotMatch(await page.locator('body').innerText(), /камня|камень|Нет знаков|Прямые|Обратные/);
    await piece('d-r').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Красный d-кварк, заряд −1\/3 e/);
    await piece('au-b').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Антисиний u-антикварк, заряд −2\/3 e/);
    assert.doesNotMatch(await page.locator('#runeTooltip').textContent(), /камень|Обратный знак|Марс|Венер|Лун/);
    await piece('u-r').click();
    assert.equal(await page.locator('#balanceValue').textContent(), 'Не скомпенсирован');
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('#balanceValue').isVisible(), false);
    assert.equal(await page.locator('.palette-labels').isVisible(), false);
    assert.equal(await page.locator('#slotCount').textContent(), '1 / 3 камня');
    assert.equal(await page.locator('.family-symbol:visible').count(), 3);
    assert.equal(await page.locator('#resultTitle').textContent(), 'Печать не собрана');
    assert.equal(await page.locator('#resultDetail').textContent(), 'Добавь ещё один камень');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#resultTitle').textContent(), 'Помести камень на алхимический круг');
  });

  it('lists particles after ingredients, qualifies neutral mixtures, and hides examples in alchemy', async () => {
    await page.locator('[data-theme-choice="instrument"]').click();
    const cases = [
      { ids: ['u-r', 'u-g', 'd-b'], formula: 'uud', examples: ['протон', 'Δ⁺'] },
      { ids: ['u-r', 'd-g', 'd-b'], formula: 'udd', examples: ['нейтрон', 'Δ⁰'] },
      { ids: ['u-r', 'u-g', 'u-b'], formula: 'uuu', examples: ['Δ⁺⁺'] },
      { ids: ['d-r', 'd-g', 'd-b'], formula: 'ddd', examples: ['Δ⁻'] },
      { ids: ['au-r', 'au-g', 'ad-b'], formula: 'ūūd̄', examples: ['антипротон', 'античастица Δ⁺, заряд −1 e'] },
      { ids: ['au-r', 'ad-g', 'ad-b'], formula: 'ūd̄d̄', examples: ['антинейтрон', 'античастица Δ⁰, заряд 0 e'] },
      { ids: ['au-r', 'au-g', 'au-b'], formula: 'ūūū', examples: ['античастица Δ⁺⁺, заряд −2 e'] },
      { ids: ['ad-r', 'ad-g', 'ad-b'], formula: 'd̄d̄d̄', examples: ['античастица Δ⁻, заряд +1 e'] },
      { ids: ['u-r', 'ad-r'], formula: 'ud̄', examples: ['пион π⁺', 'ρ-мезон ρ⁺'] },
      { ids: ['d-r', 'au-r'], formula: 'dū', examples: ['пион π⁻', 'ρ-мезон ρ⁻'] },
      { ids: ['u-r', 'au-r'], formula: 'uū', examples: ['нейтральный пион π⁰ (компонент)', 'нейтральный ρ-мезон ρ⁰ (компонент)'], neutral: true },
      { ids: ['d-r', 'ad-r'], formula: 'dd̄', examples: ['нейтральный пион π⁰ (компонент)'], neutral: true }
    ];
    for (const entry of cases) {
      await page.evaluate(ids => { setRecipe(ids); bindSeal(); }, entry.ids);
      await page.locator('[data-ability="0"]').click();
      const text = await page.locator('#runeTooltip').textContent();
      assert.ok(text.includes(`Валентный состав: ${entry.formula}`));
      for (const name of entry.examples) assert.ok(text.includes(`• ${name}`));
      assert.ok(text.indexOf('Состав:') < text.indexOf('Примеры частиц'));
      assert.doesNotMatch(text, /сопоставление по валентным ароматам|не определение частицы/);
      if (entry.neutral) assert.match(text, /входят в суперпозиции.*не определяет нейтральный мезон/s);
      if (entry.formula === 'uud') {
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#runeTooltip').isVisible(), true);
        await page.screenshot({ path: path.join(artifacts, 'scientific-particle-description.png') });
      }
      await page.locator('[data-release="0"]').click();
    }
    await page.evaluate(() => { setRecipe(['u-r', 'u-g', 'd-b']); bindSeal(); });
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.locator('[data-ability="0"]').click();
    assert.doesNotMatch(await page.locator('#runeTooltip').textContent(), /кварк|Валентный|Примеры частиц|протон/);
  });
});

describe('Named alchemical scale', () => {
  it('keeps color tracks exclusive to the scientific mode', async () => {
    const tracks = page.locator('#balanceTracks');
    const fills = () => page.locator('.balance-track-fill').evaluateAll(nodes => nodes.map(node => [node.style.left, node.style.width]));
    assert.deepEqual(await fills(), Array(3).fill(['50%', '0%']));
    await piece('u-r').click();
    const partial = await fills();
    assert.ok(parseFloat(partial[0][1]) > 0);
    assert.ok(parseFloat(partial[1][0]) < 50 && parseFloat(partial[2][0]) < 50);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await tracks.isVisible(), false);
      assert.equal(await page.locator('#balanceTitle').isVisible(), false);
      assert.equal(await page.locator('.balance-extents').isVisible(), false);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await tracks.isVisible(), true);
    assert.deepEqual(await fills(), partial);
    assert.equal(await page.locator('#balanceTitle').isVisible(), true);
    assert.deepEqual(await page.locator('.balance-track > span:visible').allTextContents(), ['r', 'g', 'b']);
    await piece('au-r').click();
    assert.deepEqual(await fills(), Array(3).fill(['50%', '0%']));
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await tracks.isVisible(), false);
    await page.locator('#reset').click();
    assert.deepEqual(await fills(), Array(3).fill(['50%', '0%']));
  });

  it('tracks partial contributions without claiming a completed action and aligns five named stops', async () => {
    const scaleColors = () => page.evaluate(() => {
      const marker = getComputedStyle(document.querySelector('#actionMarker'));
      return [marker.backgroundColor, marker.borderTopColor, getComputedStyle(document.querySelector('#actionFill')).backgroundColor];
    });
    const incompleteColors = Array(3).fill('rgb(239, 142, 135)');
    const readyColors = Array(3).fill('rgb(211, 183, 129)');
    const names = ['Сжатие', 'Притяжение', 'Удержание', 'Отталкивание', 'Рассеивание'];
    assert.deepEqual(await page.locator('.action-name').allTextContents(), names);
    assert.deepEqual(await page.locator('.action-value').allTextContents(), ['−2', '−1', '0', '+1', '+2']);
    assert.deepEqual(await page.locator('.action-direction').allTextContents(), ['К себе', 'От себя']);
    assert.deepEqual(await page.evaluate(() => actions.map(action => action.detail)), [
      'Спрессовывает вещество в плотный сгусток.',
      'Резко тянет выбранный предмет к тебе.',
      'Обездвиживает выбранный предмет, фиксируя его на месте.',
      'Отбрасывает выбранный предмет от тебя.',
      'Разрушает цельную форму предмета, рассеивая его вещество вокруг.'
    ]);
    assert.equal(await page.locator('#actionMarker').isVisible(), false);
    assert.equal(await page.locator('#actionFill').isVisible(), false);
    assert.equal(await page.locator('[aria-current="true"]').count(), 0);
    await piece('u-r').click();
    const partial = await page.locator('#actionMarker').evaluate(node => parseFloat(node.style.top));
    assert.ok(partial > 50 && partial < 75);
    assert.equal(await page.locator('#actionMarker').isVisible(), true);
    assert.equal(await page.locator('#actionScale').getAttribute('data-ready'), 'false');
    assert.deepEqual(await scaleColors(), incompleteColors);
    await page.locator('#reset').click();
    await piece('au-r').click();
    assert.ok(await page.locator('#actionMarker').evaluate(node => parseFloat(node.style.top) < 50));
    assert.deepEqual(await scaleColors(), incompleteColors);
    await page.evaluate(() => setRecipe(['u-r', 'ad-g']));
    assert.equal(await page.locator('#actionMarker').evaluate(node => node.style.top), '75%');
    assert.equal(await page.locator('#actionSteps [aria-current]').count(), 0);
    assert.deepEqual(await scaleColors(), incompleteColors, 'Integer charge alone does not complete a seal');
    const recipes = [['au-r', 'au-g', 'au-b'], ['d-r', 'd-g', 'd-b'], ['u-r', 'au-r'], ['u-r', 'ad-r'], ['u-r', 'u-g', 'u-b']];
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let index = 0; index < recipes.length; index++) {
        await page.evaluate(ids => setRecipe(ids), recipes[index]);
        assert.deepEqual(await scaleColors(), readyColors);
        const alignment = await page.evaluate(() => {
          const marker = document.querySelector('#actionMarker').getBoundingClientRect();
          const active = document.querySelector('#actionSteps [aria-current="true"]').getBoundingClientRect();
          return { delta: marker.y + marker.height / 2 - active.y - active.height / 2, right: active.right };
        });
        assert.ok(Math.abs(alignment.delta) < 1, `Scale stop ${index} aligns at ${width}px`);
        assert.ok(alignment.right <= width);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(artifacts, 'alchemy-named-scale.png'), fullPage: true });
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#actionScale').isVisible(), false);
    assert.equal(await page.locator('#chargeMarker').isVisible(), true);
    assert.equal(await page.locator('#chargeMarker').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(177, 230, 238)');
    assert.doesNotMatch(await page.locator('body').innerText(), /Компенсация цвета не означает/);
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('#actionMarker').isVisible(), false);
    assert.equal(await page.locator('#actionFill').isVisible(), false);
    assert.equal(await page.locator('#actionSteps [aria-current]').count(), 0);
    await piece('d-r').click();
    assert.deepEqual(await scaleColors(), incompleteColors, 'A new incomplete assembly returns to red');
  });
});

describe('Touch rune inspection', () => {
  it('long-presses inventory and socket runes without inserting or removing, then accepts the next tap', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'ru-RU' });
    try {
      const mobile = await mobileContext.newPage();
      mobile.on('pageerror', error => errors.push(error.message));
      mobile.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
      await mobile.goto(url);
      const cdp = await mobileContext.newCDPSession(mobile);
      const longPress = async (target, isSocketTarget = false) => {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        const point = isSocketTarget ? await socketPoint(target) : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await mobile.waitForFunction(() => !document.querySelector('#runeTooltip').hidden);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const inventory = mobile.locator('.piece[data-id="u-r"]');
      await longPress(inventory);
      assert.deepEqual(await mobile.evaluate(() => slots), [null, null, null]);
      assert.match(await mobile.locator('#runeTooltip').textContent(), /От себя: 2\/3/);
      await inventory.tap();
      assert.deepEqual(await mobile.evaluate(() => slots), ['u-r', null, null]);
      const placed = mobile.locator('.socket[data-piece="u-r"]');
      await longPress(placed);
      assert.deepEqual(await mobile.evaluate(() => slots), ['u-r', null, null]);
      await placed.tap();
      assert.deepEqual(await mobile.evaluate(() => slots), [null, null, null]);
      const smallTarget = mobile.locator('[data-insert="ad-r"]');
      await longPress(smallTarget, true);
      assert.deepEqual(await mobile.evaluate(() => slots), [null, null, null]);
      await smallTarget.tap();
      assert.deepEqual(await mobile.evaluate(() => slots), ['ad-r', null, null]);
      await mobile.locator('.piece[data-id="u-r"]').tap();
      await mobile.locator('#bindSeal').tap();
      await mobile.locator('[data-ability="0"]').tap();
      assert.match(await mobile.locator('#runeTooltip').textContent(), /Малая печать отталкивания/);
      const bounds = await mobile.locator('#runeTooltip').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await mobile.locator('[data-release="0"]').tap();
      assert.equal(await mobile.locator('#inventoryCount').textContent(), '12 / 12');
      const moving = mobile.locator('.piece[data-id="d-b"]');
      await moving.scrollIntoViewIfNeeded();
      const box = await moving.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 40 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await mobile.waitForTimeout(600);
      assert.equal(await mobile.locator('#runeTooltip').isVisible(), false);
      assert.deepEqual(await mobile.evaluate(() => slots), [null, null, null]);
    } finally { await mobileContext.close(); }
  });
});

describe('Responsive presentation', () => {
  it('keeps circular contours at a stable stroke width across viewport sizes and pixel densities', async () => {
    for (const deviceScaleFactor of [1, 2]) {
      const probeContext = await browser.newContext({ deviceScaleFactor, reducedMotion: 'reduce', locale: 'ru-RU' });
      try {
        const probe = await probeContext.newPage();
        probe.on('pageerror', error => errors.push(error.message));
        probe.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
        await probe.goto(url);
        await probe.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
        for (const width of [390, 1440]) {
          await probe.setViewportSize({ width, height: 1000 });
          const contours = await probe.locator('#field :is(.engraving, .manuscript-ornament) circle').evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node);
            return { width: style.strokeWidth, effect: style.vectorEffect, rendering: style.shapeRendering };
          }));
          assert.ok(contours.length > 0);
          assert.ok(contours.every(contour => contour.width === '1px' && contour.effect === 'non-scaling-stroke' && contour.rendering.toLowerCase() === 'geometricprecision'));
          assert.equal(await probe.locator('.manuscript-inscription').first().evaluate(node => getComputedStyle(node).fontSize), '19px');
          await probe.locator('#chamber').screenshot({ path: path.join(artifacts, `contours-${width}-dpr${deviceScaleFactor}.png`) });
        }
      } finally {
        await probeContext.close();
      }
    }
  });

  it('keeps enlarged celestial signs within a separate double-ring track without crowding controls', async () => {
    await page.evaluate(() => setRecipe(['u-r', 'ad-r']));
    assert.equal(await page.locator('.celestial-orbit .sun').count(), 1);
    assert.equal(await page.locator('.celestial-orbit > *').count(), 8);
    assert.deepEqual(await page.locator('.celestial-orbit [data-alchemical]').evaluateAll(nodes => nodes.map(node => node.dataset.alchemical).sort()), ['air', 'fire', 'salt', 'saturn']);
    assert.equal(await page.locator('.celestial-orbit .comet').count(), 1);
    assert.equal(await page.locator('.celestial-orbit .moon, .celestial-orbit [data-alchemical="mercury"]').count(), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.celestial-orbit path')].some(node =>
      Object.values(families).some(family => family.path === node.getAttribute('d')))), false, 'Decorative signs do not reuse the three core glyphs');
    assert.equal(await page.locator('.celestial-orbit ellipse').count(), 0);
    assert.equal(await page.locator('.celestial-track circle').count(), 2);
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1000 });
      for (const angle of [0, 45, 90, 180, 270]) {
        const geometry = await page.evaluate(angle => {
          const orbit = document.querySelector('.celestial-orbit');
          orbit.style.transform = `rotate(${angle}deg)`;
          const field = document.querySelector('#field').getBoundingClientRect();
          const track = document.querySelector('.celestial-track').getBoundingClientRect();
          const radii = [...orbit.children].flatMap(node => {
            const box = node.getBBox();
            const matrix = node.getScreenCTM();
            return [box.x, box.x + box.width].flatMap(x => [box.y, box.y + box.height].map(y => {
              const point = new DOMPoint(x, y).matrixTransform(matrix);
              return Math.hypot((point.x - field.left) * 640 / field.width - 320, (point.y - field.top) * 600 / field.height - 294);
            }));
          });
          const aligned = [...orbit.querySelectorAll('[data-alchemical]')].every(node => {
            const matrix = node.getScreenCTM();
            const dx = matrix.e - (field.left + field.width * 320 / 640);
            const dy = matrix.f - (field.top + field.height * 294 / 600);
            const tangentDot = (matrix.a * dx + matrix.b * dy) / (Math.hypot(matrix.a, matrix.b) * Math.hypot(dx, dy));
            return Math.abs(tangentDot) < .00001 && -matrix.c * dx - matrix.d * dy > 0;
          });
          return { radii, aligned, fits: document.documentElement.scrollWidth <= innerWidth,
            topClear: track.top > document.querySelector('#capacity').getBoundingClientRect().bottom,
            bottomClear: track.bottom < document.querySelector('.field-status').getBoundingClientRect().top };
        }, angle);
        assert.ok(geometry.radii.every(radius => radius > 285 && radius < 319), `${width}/${angle}: signs stay between the two bands`);
        assert.ok(geometry.aligned, `${width}/${angle}: symbol bases follow the tangent and their tops face outward`);
        assert.ok(geometry.fits && geometry.topClear && geometry.bottomClear, `${width}/${angle}: track clears controls and viewport edges`);
      }
    }
  });

  it('turns diamonds continuously and wakes counter-rotating celestial signs only for completed seals', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const motion = () => page.evaluate(() => ['.orbit', '.celestial-orbit'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return { name: style.animationName, direction: style.animationDirection, play: style.animationPlayState, visible: style.visibility };
    }));
    assert.deepEqual(await motion(), [
      { name: 'orbit-turn', direction: 'normal', play: 'running', visible: 'visible' },
      { name: 'orbit-turn', direction: 'reverse', play: 'paused', visible: 'hidden' }
    ]);
    await piece('u-r').click();
    assert.equal((await motion())[1].play, 'paused');
    await piece('ad-r').click();
    assert.equal(await state(), 'balanced');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.celestial-orbit')).visibility === 'visible');
    assert.equal((await motion())[1].play, 'running');
    assert.equal((await motion())[1].visible, 'visible');
    const turns = await page.evaluate(() => ['.orbit', '.celestial-orbit'].map(selector => {
      const node = document.querySelector(selector);
      const animation = node.getAnimations().find(animation => animation.animationName === 'orbit-turn');
      const savedTime = animation.currentTime;
      animation.pause();
      animation.currentTime = 1000;
      const first = new DOMMatrix(getComputedStyle(node).transform);
      animation.currentTime = 2000;
      const second = new DOMMatrix(getComputedStyle(node).transform);
      animation.currentTime = savedTime;
      animation.play();
      return second.b - first.b;
    }));
    assert.ok(turns[0] > 0 && turns[1] < 0, 'The two orbits really turn in opposite directions');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok((await motion()).every(orbit => orbit.name === 'none'));
    assert.equal((await motion())[1].visible, 'visible', 'Reduced motion keeps completed celestial signs static');
    await piece('u-b').click();
    assert.notEqual(await state(), 'balanced');
    assert.equal((await motion())[1].visible, 'hidden');
    await page.locator('#reset').click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal((await motion())[0].play, 'running');
    assert.equal((await motion())[1].play, 'paused');
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
    assert.equal((await motion())[1].play, 'running');
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.ok((await motion()).every(orbit => orbit.name === 'none'));
    assert.equal(await page.locator('.celestial-orbit').isVisible(), false);
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal((await motion())[1].play, 'running');
    await page.locator('#bindSeal').click();
    assert.equal(await state(), 'empty');
    assert.equal((await motion())[0].play, 'running');
    assert.equal((await motion())[1].play, 'paused');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.celestial-orbit')).visibility === 'hidden');
  });

  it('keeps stone contributions inside the manuscript inscription band at every viewport size', async () => {
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1000 });
      for (const ids of [['u-r', 'u-g', 'u-b'], ['au-r', 'au-g', 'au-b'], ['u-r', 'd-r', 'ad-r']]) {
        await page.evaluate(ids => setRecipe(ids), ids);
        const radii = await page.evaluate(() => {
          const field = document.querySelector('#field').getBoundingClientRect();
          return [...document.querySelectorAll('.socket .piece-charge')].flatMap(node => {
            const box = node.getBoundingClientRect();
            return [box.left, box.right].flatMap(x => [box.top, box.bottom].map(y =>
              Math.hypot((x - field.left) * 640 / field.width - 320, (y - field.top) * 600 / field.height - 294)));
          });
        });
        assert.equal(radii.length, 12);
        assert.ok(radii.every(radius => radius < 250), `${width}/${ids}: contributions do not enter the inscription band`);
      }
    }
  });

  it('keeps the dark manuscript legible and meaningful light visible without changing the scientific theme', async () => {
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = name => style.getPropertyValue(name).trim().slice(1).match(/../g)
        .map(value => parseInt(value, 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const background = luminance('--bg');
      return { background, text: ['--ink', '--muted', '--accent'].map(name => (luminance(name) + .05) / (background + .05)),
        pigments: ['--red', '--green', '--blue'].map(name => (luminance(name) + .05) / (background + .05)) };
    });
    assert.ok(contrast.background < .01, 'The original near-black background is restored');
    assert.ok(contrast.text.every(ratio => ratio >= 4.5), 'Text contrasts with the dark background');
    assert.ok(contrast.pigments.every(ratio => ratio >= 3), 'Colored glyphs remain distinct from the background');
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(16, 15, 16)');
    for (const selector of ['h1', '#libraryTitle', '#abilitiesTitle']) {
      assert.equal(await page.locator(selector).evaluate(node => getComputedStyle(node, '::first-letter').color === getComputedStyle(node).color), true);
    }
    assert.equal(await page.locator('.manuscript-ornament').isVisible(), true);
    await socketTarget('u-r').focus();
    const highlight = page.locator('[data-axis="red-false"] .socket-highlight');
    assert.equal(await page.locator('#preview').isVisible(), true);
    assert.equal(await highlight.evaluate(node => getComputedStyle(node).opacity), '1');
    assert.match(await highlight.evaluate(node => getComputedStyle(node).filter), /drop-shadow/);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.capacity-dot.spent').count(), 1);
    assert.equal(await page.locator('#focus').evaluate(node => getComputedStyle(node).opacity), '1');
    await piece('ad-r').click();
    assert.equal(await state(), 'balanced');
    assert.equal(await page.locator('#alchemySeal').evaluate(node => getComputedStyle(node).opacity), '1');
    assert.equal(await page.locator('#bindSeal').isVisible(), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await page.locator('.orbit').evaluate(node => getComputedStyle(node).animationName), 'orbit-turn');
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('.manuscript-ornament').isVisible(), false);
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(12, 18, 26)');
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.deepEqual(await selected(), ['u-r', 'ad-r', null]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.orbit').evaluate(node => getComputedStyle(node).animationName), 'none');
  });

  it('keeps the target stationary and dominant while the light point leaves and returns', async () => {
    const geometry = () => page.evaluate(() => {
      const target = document.querySelector('#centerTarget');
      const focus = document.querySelector('#focus').transform.baseVal.consolidate().matrix;
      const rect = target.getBoundingClientRect();
      return {
        target: { x: target.cx.baseVal.value, y: target.cy.baseVal.value, r: target.r.baseVal.value, screenX: rect.x, screenY: rect.y },
        focus: { x: focus.e, y: focus.f },
        targetOpacity: Number(getComputedStyle(target).opacity),
        guides: [...document.querySelectorAll('.triangle, .guide')].map(node => ({ opacity: Number(getComputedStyle(node).opacity), dash: getComputedStyle(node).strokeDasharray }))
      };
    });
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      const empty = await geometry();
      assert.ok(empty.targetOpacity >= .8);
      assert.ok(empty.guides.every(guide => guide.opacity <= .12 && guide.dash !== 'none'));
      await piece('u-r').click();
      const seeking = await geometry();
      assert.deepEqual(seeking.target, empty.target);
      assert.ok(Math.hypot(seeking.focus.x - empty.target.x, seeking.focus.y - empty.target.y) > empty.target.r);
      await page.screenshot({ path: path.join(artifacts, `${theme}-desktop-seeking.png`), fullPage: true });
      await piece('ad-r').click();
      const balanced = await geometry();
      assert.deepEqual(balanced.target, empty.target);
      assert.deepEqual(balanced.focus, { x: empty.target.x, y: empty.target.y });
      await page.locator('#reset').click();
    }
    assert.equal(await page.locator('#construction').count(), 0);
  });

  it('uses two stone sizes and nested sockets on the six circular directions', async () => {
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        big: box('.piece[data-id="u-r"] .rune-frame'), small: box('.piece[data-id="d-r"] .rune-frame'),
        outer: box('.socket-outline-large'), inner: box('.socket-outline-small'),
        field: box('#field'), sockets: [...document.querySelectorAll('.orbit-slot')].map(node => node.getBoundingClientRect().toJSON())
      };
    });
    assert.ok(Math.abs(layout.small.width / layout.big.width - .57) < .01);
    assert.ok(Math.abs(layout.inner.width / layout.outer.width - .57) < .01);
    assert.equal(await page.locator('.stone-bevel, .stone-edge, .stone-face, .rune-mark').count(), 0);
    assert.ok(await page.locator('#palette .rune-stone').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).filter === 'none')));
    assert.equal(await page.locator('.tray').count(), 0);
    for (const socket of layout.sockets) {
      const x = (socket.x + socket.width / 2 - layout.field.x) / layout.field.width * 640;
      const y = (socket.y + socket.height / 2 - layout.field.y) / layout.field.height * 600;
      assert.ok(Math.abs(Math.hypot(x - 320, y - 294) - 208) < .1, 'Socket sits on the circle, not above it');
    }
    assert.equal(await page.locator('.socket-outlines path').count(), 12);
    assert.equal(await page.locator('.examples .dice').count(), 3);
  });

  it('centers all three planetary glyphs and uses quark notation in the scientific theme', async () => {
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      assert.equal(await page.locator('.stone-face, .rune-mark').count(), 0);
      if (theme === 'instrument') {
        assert.deepEqual(await page.locator('#palette .piece.red .quark-glyph').allTextContents(), ['u', 'd', 'ū', 'd̄']);
        assert.equal(await piece('u-r').locator('.rune-glyph').isVisible(), false);
        continue;
      }
      const positions = await page.locator('#palette .piece').evaluateAll(nodes => nodes.map(node => {
        const glyph = node.querySelector('.rune-glyph').getBoundingClientRect();
        const stone = node.querySelector('.rune-frame').getBoundingClientRect();
        return {
          x: (glyph.x + glyph.width / 2 - stone.x) / stone.width,
          y: (glyph.y + glyph.height / 2 - stone.y) / stone.height
        };
      }));
      assert.equal(positions.length, 12);
      for (const position of positions) {
        assert.ok(Math.abs(position.x - .5) < .01, 'Planetary glyph is horizontally centered');
        assert.ok(Math.abs(position.y - .5) < .01, 'Planetary glyph is vertically centered');
      }
      assert.deepEqual(await page.evaluate(() => Object.values(families).map(family => family.label)), ['♂', '♀', '☾']);
      assert.equal(await piece('u-b').locator('.rune-glyph').evaluate(node => getComputedStyle(node).strokeDasharray), 'none');
      assert.equal(await piece('au-b').locator('.rune-glyph').evaluate(node => getComputedStyle(node).strokeDasharray), 'none');
      await page.locator('#palette').screenshot({ path: path.join(artifacts, `planetary-glyphs-${theme}.png`) });
    }
  });

  it('shrinks and reflects every planetary glyph consistently in inventory and occupied sockets', async () => {
    const reverseAxes = { red: [-.9, -.9], green: [.9, -.9], blue: [-.9, .9] };
    for (const ids of [[], ['u-r', 'u-g', 'u-b'], ['d-r', 'd-g', 'd-b'], ['au-r', 'au-g', 'au-b'], ['ad-r', 'ad-g', 'ad-b']]) {
      await page.evaluate(ids => setRecipe(ids), ids);
      const glyphs = await page.locator('#palette .piece .rune-glyph, #slots .socket.filled .rune-glyph').evaluateAll(nodes => nodes.map(node => {
        const owner = node.closest('.piece, .socket');
        const piece = byId[owner.dataset.id || owner.dataset.piece];
        const matrix = node.transform.baseVal.consolidate().matrix;
        const center = new DOMPoint(24, 25.5).matrixTransform(matrix);
        const glyph = node.getBoundingClientRect();
        const frame = owner.querySelector('.rune-frame').getBoundingClientRect();
        const rawGlyph = node.getBBox();
        const rawFrame = owner.querySelector('.rune-frame').getBBox();
        return { id: piece.id, color: piece.color, anti: piece.anti, sx: matrix.a, sy: matrix.d,
          center: [center.x, center.y], dashed: getComputedStyle(node).strokeDasharray,
          widthScale: glyph.width / frame.width / (rawGlyph.width / rawFrame.width),
          heightScale: glyph.height / frame.height / (rawGlyph.height / rawFrame.height),
          x: (glyph.x + glyph.width / 2 - frame.x) / frame.width,
          y: (glyph.y + glyph.height / 2 - frame.y) / frame.height };
      }));
      assert.equal(glyphs.length, 12 + ids.length);
      for (const glyph of glyphs) {
        const axes = glyph.anti ? reverseAxes[glyph.color] : [.9, .9];
        assert.ok(Math.abs(glyph.sx - axes[0]) < .00001 && Math.abs(glyph.sy - axes[1]) < .00001, `${glyph.id}: correct reflection axes`);
        assert.ok(Math.abs(glyph.center[0] - 24) < .00001 && Math.abs(glyph.center[1] - 26) < .00001, `${glyph.id}: fixed transform center`);
        assert.equal(glyph.dashed, 'none');
        assert.ok(Math.abs(glyph.widthScale - .9) < .001 && Math.abs(glyph.heightScale - .9) < .001, `${glyph.id}: 10 percent smaller inside the same frame`);
        assert.ok(Math.abs(glyph.x - .5) < .01 && Math.abs(glyph.y - .5) < .01, `${glyph.id}: centered after reflection`);
      }
    }
    await page.locator('#chamber').screenshot({ path: path.join(artifacts, 'reverse-planetary-glyphs.png') });
  });

  it('enlarges the field, stones, slots, and text together on a large screen', async () => {
    const sizes = () => page.evaluate(() => ({
      field: document.querySelector('#field').getBoundingClientRect().width,
      stone: document.querySelector('.piece .rune').getBoundingClientRect().width,
      slot: document.querySelector('.socket-face').getBoundingClientRect().width,
      heading: document.querySelector('h1').getBoundingClientRect().height
    }));
    const normal = await sizes();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForFunction(() => Number(document.documentElement.style.getPropertyValue('--workspace-scale')) > 1.3);
    const large = await sizes();
    for (const key of Object.keys(normal)) assert.ok(large[key] > normal[key] * 1.3, `${key} should grow with the screen`);
    await piece('u-r').click();
    await piece('ad-r').click();
    await page.screenshot({ path: path.join(artifacts, 'artifact-large-screen.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.screenshot({ path: path.join(artifacts, 'instrument-large-screen.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => Number(document.documentElement.style.getPropertyValue('--workspace-scale')) === 1);
    assert.equal((await sizes()).stone, normal.stone);
  });

  it('animates stone transfer and respects reduced motion', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await piece('u-r').click();
    assert.equal(await page.locator('.stone-flight').count(), 1);
    await page.waitForFunction(() => !document.querySelector('.stone-flight'));
    await page.locator('.socket[data-slot="0"]').click();
    assert.equal(await page.locator('.stone-flight').count(), 1);
    await page.waitForFunction(() => !document.querySelector('.stone-flight'));
    assert.equal(await piece('u-r').isVisible(), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await piece('u-r').click();
    assert.equal(await page.locator('.stone-flight').count(), 0);
  });

  it('fits narrow mobile, tablet, and desktop widths in both modes', async () => {
    for (const width of [320, 390, 680, 768, 960, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        const bounds = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          buttons: [...document.querySelectorAll('.piece')].map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
          field: document.getElementById('field').getBoundingClientRect().toJSON(),
          glyphs: [...document.querySelectorAll(document.documentElement.dataset.theme === 'artifact' ? '.axis-node .rune-glyph' : '.axis-node .quark-glyph')].map(node => node.getBoundingClientRect().toJSON())
        }));
        assert.ok(bounds.document <= bounds.viewport, `${theme} at ${width}px overflows horizontally`);
        assert.ok(bounds.buttons.every(box => box.width >= 40 && box.height >= 44), `${theme} at ${width}px has unusable targets`);
        assert.ok(bounds.field.width >= 270, `${theme} at ${width}px shrinks the central field too far`);
        assert.equal(bounds.glyphs.length, 6);
        for (const glyph of bounds.glyphs) {
          assert.ok(glyph.width < bounds.field.width * .08 && glyph.height < bounds.field.height * .08, 'Axis glyph stays small relative to the field');
          assert.ok(glyph.x > bounds.field.x && glyph.y > bounds.field.y && glyph.right < bounds.field.right && glyph.bottom < bounds.field.bottom, 'Axis glyph stays inside the field');
        }
      }
    }
  });

  it('captures both visual directions and a real touch interaction', async () => {
    await page.screenshot({ path: path.join(artifacts, 'artifact-desktop-empty.png'), fullPage: true });
    await page.locator('#next3').click();
    await page.screenshot({ path: path.join(artifacts, 'artifact-desktop-triad.png'), fullPage: true });
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.screenshot({ path: path.join(artifacts, 'instrument-desktop-triad.png'), fullPage: true });
    await page.locator('#next2').click();
    await page.screenshot({ path: path.join(artifacts, 'instrument-desktop-pair.png'), fullPage: true });

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'ru-RU' });
    try {
      const mobile = await mobileContext.newPage();
      mobile.on('pageerror', error => errors.push(error.message));
      await mobile.goto(url);
      await mobile.locator('.piece[data-id="u-r"]').tap();
      await mobile.locator('.piece[data-id="ad-r"]').tap();
      assert.equal(await mobile.locator('#chamber').getAttribute('data-state'), 'balanced');
      assert.equal(await mobile.locator('#preview').isVisible(), false);
      await mobile.screenshot({ path: path.join(artifacts, 'artifact-mobile-pair.png'), fullPage: true });
      await mobile.locator('[data-theme-choice="instrument"]').tap();
      await mobile.screenshot({ path: path.join(artifacts, 'instrument-mobile-pair.png'), fullPage: true });
      await mobile.locator('.socket[data-piece="u-r"]').tap();
      assert.equal(await mobile.locator('.piece[data-id="u-r"]').isVisible(), true);
      assert.equal(await mobile.locator('.socket.filled').count(), 1);
      assert.equal(await mobile.locator('#chamber').getAttribute('data-state'), 'seeking');
      for (const theme of ['artifact', 'instrument']) {
        await mobile.locator(`[data-theme-choice="${theme}"]`).tap();
        await mobile.locator('#reset').tap();
        for (const id of ['u-r', 'ad-r']) {
          const point = await socketPoint(mobile.locator(`[data-insert="${id}"]`));
          await mobile.touchscreen.tap(point.x, point.y);
          assert.equal(await mobile.locator(`.socket[data-piece="${id}"]`).count(), 1);
        }
        assert.equal(await mobile.locator('#chamber').getAttribute('data-state'), 'balanced');
        assert.equal(await mobile.locator('#preview').isVisible(), false);
      }
    } finally { await mobileContext.close(); }
  });
});
