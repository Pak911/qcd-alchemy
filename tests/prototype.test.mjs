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

describe('QCD rules and interaction', () => {
  it('opens directly from disk without a server or an initial success state', async () => {
    assert.equal(await page.locator('.piece').count(), 12);
    assert.equal(await page.locator('.socket').count(), 6);
    assert.equal(await page.locator('.socket:disabled').count(), 6);
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
    assert.equal(await state(), 'balanced');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'instrument');
    assert.equal(await state(), 'empty');
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
    assert.ok(Math.abs(layout.small.width / layout.big.width - .76) < .01);
    assert.ok(Math.abs(layout.inner.width / layout.outer.width - .76) < .01);
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
          glyphs: [...document.querySelectorAll('.axis-node .rune-glyph')].map(node => node.getBoundingClientRect().toJSON())
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
    } finally { await mobileContext.close(); }
  });
});
