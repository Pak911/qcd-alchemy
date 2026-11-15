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
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
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

  it('randomly samples all 28 valid inventories without immediate repeats', async () => {
    assert.deepEqual(await page.evaluate(() => [recipes2.length, recipes3.length]), [12, 16]);
    for (const [button, count] of [['next2', 12], ['next3', 16]]) {
      const seen = new Set();
      for (let i = 0; i < count; i++) {
        if (await page.locator('#reset').isEnabled()) await page.locator('#reset').click();
        await page.evaluate(value => { Math.random = () => value; }, (i + .25) / count);
        await page.locator(`#${button}`).click();
        assert.equal(await state(), 'balanced');
        seen.add((await selected()).join(','));
        assert.match(await page.locator('#cycleNote').textContent(), /Случайная/);
        assert.equal(await page.locator('.piece.in-use').count(), button === 'next2' ? 2 : 3);
        const widths = await page.locator('.balance-track-fill').evaluateAll(nodes => nodes.map(node => node.style.width));
        assert.deepEqual(widths, ['0%', '0%', '0%']);
      }
      assert.equal(seen.size, count);
      const previous = await selected();
      await page.locator(`#${button}`).click();
      assert.notDeepEqual(await selected(), previous);
    }
    await page.locator('.socket[data-slot="0"]').click();
    assert.equal(await page.locator('#cycleNote').textContent(), '');
    await page.locator('#reset').click();
    assert.equal(await page.locator('.piece:visible').count(), 12);
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
    for (const ids of recipes) {
      const q = await page.evaluate(ids => { setRecipe(ids); return totalThirds() / 3; }, ids);
      const expected = ids.length === 2 ? `Малое ${names[q + 2].toLowerCase()}` : names[q + 2];
      assert.equal(await page.locator('#abilityName').textContent(), expected);
      assert.equal(await page.locator('#resultTitle').textContent(), expected);
      assert.equal(await page.locator('#actionSteps [aria-current="true"] .action-name').textContent(), names[q + 2]);
      assert.equal(await page.locator('#actionMarker').evaluate(node => node.style.top), `${(q + 2) * 25}%`);
      assert.equal(await page.locator('#bindSeal').isVisible(), true);
      const icon = page.locator('#alchemySeal .seal-icon');
      const key = `${await icon.getAttribute('data-size')}:${await icon.getAttribute('data-action')}`;
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
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const cards = await page.locator('.ability-slot').evaluateAll(nodes => nodes.map(node => {
          const label = node.querySelector('.ability-label').getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return label.left >= box.left && label.right <= box.right && label.bottom <= box.bottom;
        }));
        assert.ok(cards.every(Boolean), `Labels must fit at ${width}px in ${theme}`);
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
    assert.equal(await page.locator('#abilitiesTitle').textContent(), 'Собранные состояния');
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
    assert.match(await tooltip.textContent(), /пси.*К себе: 1\/3/s);
    assert.equal(await tooltip.isVisible(), true);
    assert.deepEqual(await selected(), [null, null, null]);
    await tooltip.hover();
    await page.waitForTimeout(300);
    assert.equal(await tooltip.isVisible(), true, 'The description remains available while hovered');
    await page.keyboard.press('Escape');
    assert.equal(await tooltip.isVisible(), false);
    await piece('u-g').focus();
    assert.match(await tooltip.textContent(), /молния.*От себя: 2\/3/s);
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
  it('centers a bounded seal on the target at every viewport size and retains the release animation', async () => {
    await page.evaluate(() => setRecipe(['u-r', 'u-g', 'u-b']));
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
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => setRecipe(['d-r', 'ad-r']));
    assert.equal(await page.locator('.release-ring').evaluate(node => getComputedStyle(node).animationName), 'release');
    assert.equal(await page.locator('#alchemySeal .seal-icon').evaluate(node => getComputedStyle(node).animationName), 'seal-imprint');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#alchemySeal .seal-icon').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.screenshot({ path: path.join(artifacts, 'seal-completed-desktop.png'), fullPage: true });
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
  it('keeps alchemy uncluttered and uses scientific labels throughout the other theme', async () => {
    assert.equal(await page.locator('#balanceValue').isVisible(), false);
    assert.equal(await page.locator('#balanceTitle').isVisible(), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /Разные знаки|Общий центр/);
    await piece('d-r').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Малый камень.*К себе: 1\/3/s);
    await piece('u-g').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /От себя: 2\/3/);
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#libraryTitle').textContent(), 'Кварки и антикварки');
    assert.equal(await page.locator('#forwardLabel').textContent(), 'Кварки');
    assert.equal(await page.locator('#reverseLabel').textContent(), 'Антикварки');
    assert.equal(await page.locator('#slotCount').textContent(), 'Компоненты: 0 / 3');
    assert.equal(await page.locator('#balanceValue').textContent(), 'Нет кварков');
    assert.equal(await page.locator('#fieldLabel').textContent(), 'Цветовая диаграмма');
    assert.equal(await page.locator('#resultTitle').textContent(), 'Состав не выбран');
    assert.doesNotMatch(await page.locator('body').innerText(), /камня|камень|Нет знаков|Прямые|Обратные/);
    await piece('d-r').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Красный d-кварк, заряд −1\/3 e/);
    await piece('au-b').hover();
    assert.match(await page.locator('#runeTooltip').textContent(), /Антисиний u-антикварк, заряд −2\/3 e/);
    assert.doesNotMatch(await page.locator('#runeTooltip').textContent(), /камень|Обратный знак|ромб/);
    await piece('u-r').click();
    assert.equal(await page.locator('#balanceValue').textContent(), 'Не скомпенсирован');
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('#balanceValue').isVisible(), false);
    assert.equal(await page.locator('#slotCount').textContent(), '1 / 3 камня');
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
  it('tracks partial contributions without claiming a completed action and aligns five named stops', async () => {
    const names = ['Сжатие', 'Притяжение', 'Удержание', 'Отталкивание', 'Рассеивание'];
    assert.deepEqual(await page.locator('.action-name').allTextContents(), names);
    assert.deepEqual(await page.locator('.action-value').allTextContents(), ['−2', '−1', '0', '+1', '+2']);
    assert.deepEqual(await page.locator('.action-direction').allTextContents(), ['К себе', 'От себя']);
    assert.deepEqual(await page.evaluate(() => actions.map(action => action.detail)), [
      'Собирает вещество в плотное целое.',
      'Притягивает предмет к игроку, сохраняя его форму.',
      'Закрепляет предмет на месте.',
      'Отталкивает предмет от игрока как единое целое.',
      'Распыляет вещество в пространстве.'
    ]);
    assert.equal(await page.locator('#actionMarker').isVisible(), false);
    assert.equal(await page.locator('[aria-current="true"]').count(), 0);
    await piece('u-r').click();
    const partial = await page.locator('#actionMarker').evaluate(node => parseFloat(node.style.top));
    assert.ok(partial > 50 && partial < 75);
    assert.equal(await page.locator('#actionMarker').isVisible(), true);
    assert.equal(await page.locator('#actionScale').getAttribute('data-ready'), 'false');
    await page.evaluate(() => setRecipe(['u-r', 'ad-g']));
    assert.equal(await page.locator('#actionMarker').evaluate(node => node.style.top), '75%');
    assert.equal(await page.locator('#actionSteps [aria-current]').count(), 0);
    const recipes = [['au-r', 'au-g', 'au-b'], ['d-r', 'd-g', 'd-b'], ['u-r', 'au-r'], ['u-r', 'ad-r'], ['u-r', 'u-g', 'u-b']];
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let index = 0; index < recipes.length; index++) {
        await page.evaluate(ids => setRecipe(ids), recipes[index]);
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
    assert.doesNotMatch(await page.locator('body').innerText(), /Компенсация цвета не означает/);
    await page.locator('[data-theme-choice="artifact"]').click();
    await page.locator('#bindSeal').click();
    assert.equal(await page.locator('#actionMarker').isVisible(), false);
    assert.equal(await page.locator('#actionSteps [aria-current]').count(), 0);
  });
});

describe('Touch rune inspection', () => {
  it('long-presses inventory and socket runes without inserting or removing, then accepts the next tap', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
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
    assert.equal(await page.locator('#palette .magnitude-1 .stone-bevel, #palette .magnitude-1 .stone-edge, #palette .magnitude-1 .stone-face').count(), 0);
    assert.equal(await page.locator('.stone-bevel, .stone-edge').count(), 0);
    assert.equal(await page.locator('#palette .magnitude-2 .stone-face').count(), 6);
    assert.ok(await page.locator('#palette .rune-stone').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).filter === 'none')));
    assert.ok(await page.locator('#palette .stone-face').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fill === 'none')));
    assert.equal(await page.locator('.tray').count(), 0);
    for (const socket of layout.sockets) {
      const x = (socket.x + socket.width / 2 - layout.field.x) / layout.field.width * 640;
      const y = (socket.y + socket.height / 2 - layout.field.y) / layout.field.height * 600;
      assert.ok(Math.abs(Math.hypot(x - 320, y - 294) - 208) < .1, 'Socket sits on the circle, not above it');
    }
    assert.equal(await page.locator('.socket-outlines path').count(), 12);
    assert.equal(await page.locator('.examples .dice').count(), 3);
    assert.equal(await piece('u-r').locator('.rune-mark').count(), 2);
    assert.equal(await piece('d-r').locator('.rune-mark').count(), 1);
  });

  it('centers the alchemical trident and uses quark notation in the scientific theme', async () => {
    for (const theme of ['artifact', 'instrument']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      if (theme === 'instrument') {
        assert.deepEqual(await page.locator('#palette .piece.red .quark-glyph').allTextContents(), ['u', 'd', 'ū', 'd̄']);
        assert.equal(await piece('u-r').locator('.rune-glyph').isVisible(), false);
        continue;
      }
      const positions = await page.locator('#palette .piece.red').evaluateAll(nodes => nodes.map(node => {
        const glyph = node.querySelector('.rune-glyph').getBoundingClientRect();
        const stone = node.querySelector('.rune-frame').getBoundingClientRect();
        return {
          x: (glyph.x + glyph.width / 2 - stone.x) / stone.width,
          y: (glyph.y + glyph.height / 2 - stone.y) / stone.height
        };
      }));
      assert.equal(positions.length, 4);
      for (const position of positions) {
        assert.ok(Math.abs(position.x - .5) < .01, 'Trident is horizontally centered');
        assert.ok(position.y >= .5 && position.y <= .53, 'Trident sits slightly below the geometric center');
      }
      await page.locator('#palette .family.red').screenshot({ path: path.join(artifacts, `trident-${theme}.png`) });
    }
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

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });
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
