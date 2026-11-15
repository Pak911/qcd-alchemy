import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, describe, it } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, '.artifacts');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.browsers');
process.env.TEMP = process.env.TMP = path.join(artifacts, 'i18n-tmp');
const { chromium } = await import('playwright');
const url = pathToFileURL(path.join(root, 'qcd_magic_prototype.html')).href;
const languages = ['en', 'es', 'pt', 'zh', 'ru'];
let browser, context, page, errors, externalRequests;

before(async () => {
  await mkdir(process.env.TEMP, { recursive: true });
  browser = await chromium.launch({ headless: true, downloadsPath: artifacts });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ locale: 'en-GB', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  errors = [];
  externalRequests = [];
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url() !== url) externalRequests.push(request.url()); });
  await page.goto(url);
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(errors, [], 'No browser errors in localized interfaces');
  assert.deepEqual(externalRequests, [], 'All translations remain embedded and offline');
});

const choose = value => page.locator('#languageSelect').selectOption(value);
const translated = (key, params = {}) => page.evaluate(({ key, params }) => t(key, params), { key, params });
const placeholders = value => [...value.matchAll(/\{([A-Za-z]\w*)\}/g)].map(match => match[1]).sort();

describe('Localization', () => {
  it('themes the language popup without a focus outline and retains mouse and keyboard selection', async () => {
    const select = page.locator('#languageSelect');
    assert.equal(await select.evaluate(node => getComputedStyle(node).appearance), 'base-select');
    assert.equal(await select.evaluate(node => getComputedStyle(node).alignItems), 'center');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await choose('auto');
        await select.click();
        assert.equal(await select.evaluate(node => node.matches(':open')), true);
        const option = select.locator('option[value="es"]');
        await option.hover();
        const colors = await option.evaluate(node => ({
          actual: getComputedStyle(node).color.replace(/\s/g, ''),
          expected: `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').replace(/\s/g, '')})`,
          background: getComputedStyle(node).backgroundColor
        }));
        assert.equal(colors.actual, colors.expected);
        assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)');
        assert.equal(await select.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
        const boxes = await select.locator('option').evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
        }));
        assert.ok(boxes.every(Boolean), 'The open popup fits inside the viewport');
        await page.screenshot({ path: path.join(artifacts, `language-menu-${theme}-${width}.png`) });
        await option.click();
        assert.equal(await page.evaluate(() => languageChoice), 'es');
        assert.equal(await select.evaluate(node => node.matches(':open')), false);
        await select.press('Enter');
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        assert.equal(await select.inputValue(), 'en');
        assert.equal(await page.evaluate(() => language), 'en');
        assert.equal(await select.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
        assert.match(await select.evaluate(node => getComputedStyle(node).textDecorationLine), /underline/);
        await select.press('Enter');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        assert.equal(await select.inputValue(), 'en', 'Escape cancels navigation without choosing another language');
        await select.click();
        await page.locator('h1').click();
        assert.equal(await select.evaluate(node => node.matches(':open')), false);
        await choose('ru');
        await page.locator('.masthead').screenshot({ path: path.join(artifacts, `language-control-${theme}-${width}.png`) });
      }
    }
  });

  it('embeds complete dictionaries with matching placeholders and native language options', async () => {
    const source = await readFile(path.join(root, 'qcd_magic_prototype.html'), 'utf8');
    const outsideDictionary = source.replace(/<script id="translationDictionary">[\s\S]*?<\/script>/, '').replace('Русский', '');
    assert.equal(/[\u0400-\u04ff]/.test(outsideDictionary), false, 'Russian copy lives only in the dictionary, not duplicate HTML or rendering strings');
    const dictionaries = await page.evaluate(() => translations);
    assert.deepEqual(Object.keys(dictionaries).sort(), [...languages].sort());
    const keys = Object.keys(dictionaries.ru).sort();
    assert.ok(keys.length > 150);
    for (const locale of languages) {
      assert.deepEqual(Object.keys(dictionaries[locale]).sort(), keys, locale);
      for (const key of keys) {
        const text = dictionaries[locale][key];
        assert.equal(typeof text, 'string', `${locale}:${key}`);
        assert.ok(text.trim(), `${locale}:${key} must not be empty`);
        assert.deepEqual(placeholders(text), placeholders(dictionaries.ru[key]), `${locale}:${key}`);
        if (locale !== 'ru') assert.doesNotMatch(text, /[\u0400-\u04ff]/, `${locale}:${key} must not leak Russian`);
      }
    }
    assert.deepEqual(await page.locator('#languageSelect option').evaluateAll(nodes => nodes.map(node => node.value)), ['auto', ...languages]);
    assert.deepEqual(await page.locator('#languageSelect option').allTextContents(), ['Auto', 'English', 'Español', 'Português', '简体中文', 'Русский']);
    await choose('es');
    assert.equal(await page.evaluate(() => {
      const original = translations.es['app.artifact'];
      try { delete translations.es['app.artifact']; return t('app.artifact'); }
      finally { translations.es['app.artifact'] = original; }
    }), dictionaries.en['app.artifact'], 'Missing translated entries fall back to English');
  });

  it('names the red Mars, green Venus, and blue Moon families in every language and inspection surface', async () => {
    const names = {
      ru: ['Марс', 'Венера', 'Луна'], en: ['Mars', 'Venus', 'Moon'],
      es: ['Marte', 'Venus', 'Luna'], pt: ['Marte', 'Vênus', 'Lua'], zh: ['火星', '金星', '月亮']
    };
    const colors = ['red', 'green', 'blue'];
    const symbols = ['♂', '♀', '☾'];
    for (const locale of languages) {
      await page.keyboard.press('Escape');
      await page.locator('#languageSelect').focus();
      await choose(locale);
      const inflected = locale === 'ru' ? ['Марса', 'Венеры', 'Луны'] : names[locale];
      assert.deepEqual(await page.evaluate(() => Object.values(families).map(family => family.name)), names[locale]);
      for (const [index, color] of colors.entries()) {
        for (const prefix of ['u', 'au']) {
          const stone = page.locator(`.piece[data-id="${prefix}-${color[0]}"]`);
          assert.ok((await stone.getAttribute('aria-label')).includes(inflected[index]), `${locale}/${color}: accessible name`);
          await stone.focus();
          const text = await page.locator('#runeTooltip').textContent();
          assert.ok(text.includes(inflected[index]) && text.includes(symbols[index]), `${locale}/${color}: tooltip name and symbol: ${text}`);
          assert.doesNotMatch(text, /пси|молни|эфир|\bpsi\b|lightning|aether|rayo|raio|éter|灵能|雷电|以太/i);
        }
      }
      await page.evaluate(() => { setRecipe(['u-r', 'u-g', 'u-b']); bindSeal(); });
      await page.locator('[data-ability="0"]').click();
      const saved = await page.locator('#runeTooltip').textContent();
      assert.ok(inflected.every(name => saved.includes(name)), `${locale}: saved ingredients use the new names`);
      await page.evaluate(() => releaseAbility());
    }
  });

  it('keeps scientific explanations concise and describes balance at the diagram center in every language', async () => {
    const dictionaries = await page.evaluate(() => translations);
    for (const locale of languages) {
      const dictionary = dictionaries[locale];
      const copy = ['science.symbols', 'science.model', 'science.result', 'rune.u', 'rune.d'].map(key => dictionary[key]).join('\n');
      assert.doesNotMatch(copy, /масс|симуля|не модел|не определ|замкнут|\bmass\b|physical size|simulat|not modeled|not determined|closed bond|masa|tamaño físico|no se model|no se determin|unión cerrada|massa|tamanho físico|simula|não são|ligação fechada|质量|实际大小|模拟|自旋|闭合/i, locale);
      assert.match(dictionary['science.model'], /центр|center|centro|中心/i, `${locale}: balance is explained at the center`);
      assert.match(dictionary['science.model'], /квантовой хромодинамикой|quantum chromodynamics|cromodinámica cuántica|cromodinâmica quântica|量子色动力学/i, `${locale}: QCD inspiration is retained`);
      for (const key of ['science.symbols', 'rune.u', 'rune.d']) {
        assert.match(dictionary[key], /электрического заряда|electric charge|carga eléctrica|carga elétrica|电荷/, `${locale}/${key}: size means electric charge magnitude`);
      }
    }
  });

  it('resolves the primary browser language and its regions with an English fallback', async () => {
    assert.equal(await page.locator('#languageSelect').inputValue(), 'auto');
    assert.equal(await page.evaluate(() => language), 'en');
    for (const [tag, expected] of [
      ['en-US', 'en'], ['en-GB', 'en'], ['es-MX', 'es'], ['es-ES', 'es'],
      ['pt-BR', 'pt'], ['pt-PT', 'pt'], ['zh-Hans-CN', 'zh'], ['zh-Hant-TW', 'zh'],
      ['ru-RU', 'ru'], ['de-DE', 'en'], ['', 'en'], ['invalid_locale', 'en']
    ]) {
      await page.evaluate(tag => {
        Object.defineProperty(navigator, 'language', { configurable: true, value: tag });
        Object.defineProperty(navigator, 'languages', { configurable: true, value: ['ru-RU', 'es-ES'] });
        setLanguage('auto');
      }, tag);
      assert.equal(await page.evaluate(() => language), expected, tag);
      assert.ok((await page.locator('html').getAttribute('lang')).startsWith(expected));
      assert.equal(await page.locator('h1').textContent(), await translated('app.artifact'));
    }
  });

  it('remembers explicit choices but keeps Auto responsive to browser language changes', async () => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'language', { configurable: true, value: 'pt-BR' }));
    await page.reload();
    assert.equal(await page.evaluate(() => language), 'pt');
    await choose('es');
    await page.reload();
    assert.equal(await page.evaluate(() => language), 'es');
    assert.equal(await page.locator('#languageSelect').inputValue(), 'es');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-Hant-TW' });
      window.dispatchEvent(new Event('languagechange'));
    });
    assert.equal(await page.evaluate(() => language), 'es');
    await choose('auto');
    assert.equal(await page.evaluate(() => language), 'zh');
    assert.equal(await page.evaluate(() => localStorage.getItem('qcd-language')), 'auto');
    await page.reload();
    assert.equal(await page.evaluate(() => language), 'pt');
    assert.equal(await page.locator('#languageSelect').inputValue(), 'auto');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'language', { configurable: true, value: 'ru-RU' });
      window.dispatchEvent(new Event('languagechange'));
    });
    assert.equal(await page.evaluate(() => language), 'ru');
  });

  it('handles invalid stored preferences and unavailable browser storage', async () => {
    await page.evaluate(() => localStorage.setItem('qcd-language', 'not-a-supported-choice'));
    await page.reload();
    assert.equal(await page.evaluate(() => language), 'en');
    assert.equal(await page.locator('#languageSelect').inputValue(), 'auto');
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }));
    await page.reload();
    await choose('ru');
    assert.equal(await page.evaluate(() => language), 'ru');
    await page.reload();
    assert.equal(await page.evaluate(() => language), 'en');
  });

  it('preserves reservations, the active circle, theme, and sustained voices on language changes', async () => {
    await page.locator('[data-theme-choice="instrument"]').click();
    await page.evaluate(() => { setRecipe(['u-r', 'au-r']); bindSeal(); setRecipe(['u-g', 'ad-g']); });
    await page.waitForFunction(() => audio?.context.state === 'running');
    const before = await page.evaluate(() => {
      window.localeVoices = [...audio.strings];
      return { slots: [...slots], abilities: structuredClone(abilities), reserved: reservedIds(), soundEnabled, previousKey };
    });
    for (const locale of languages) {
      await page.locator('#languageSelect').focus();
      await choose(locale);
      assert.equal(await page.locator('#languageSelect').evaluate(node => node === document.activeElement), true, 'Language selection retains keyboard focus');
      assert.deepEqual(await page.evaluate(() => ({ slots: [...slots], abilities: structuredClone(abilities), reserved: reservedIds(), soundEnabled, previousKey })), before);
      assert.equal(await page.evaluate(() => window.localeVoices.every(voice => audio.strings.has(voice))), true, 'Locale changes must not restart the chord');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'instrument');
      assert.equal(await page.locator('#stateName').textContent(), await translated('kind.meson'));
      await page.locator('.ability-card').click();
      assert.match(await page.locator('#runeTooltip').textContent(), /uū/);
      assert.ok((await page.locator('#runeTooltip').textContent()).includes(await translated('particle.neutralNote')));
      assert.equal(await page.title(), `${await translated('app.instrument')} · QCD`);
    }
    await page.locator('#toggleSound').click();
    await choose('en');
    assert.equal(await page.evaluate(() => soundEnabled), false);
    assert.equal(await page.locator('#soundLabel').textContent(), await translated('sound.off'));
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.evaluate(() => language), 'en');
    assert.equal(await page.locator('#abilityName').textContent(), await translated('action.repulsion.smallSeal'));
  });

  it('translates dynamic descriptions and scientific examples without altering composition rules', async () => {
    for (const locale of languages) {
      await choose(locale);
      const results = await page.evaluate(() => [...recipes2, ...recipes3].map(ids => {
        const result = analyzeCombination(ids);
        const info = abilityInfo(ids);
        return { valid: result.valid, examples: result.examples, note: result.note, label: info.label, full: info.full, detail: info.detail };
      }));
      assert.equal(results.length, 28);
      for (const result of results) {
        assert.equal(result.valid, true);
        for (const text of [result.label, result.full, result.detail, ...result.examples]) {
          assert.ok(text?.trim());
          assert.doesNotMatch(text, /undefined|\{[A-Za-z]\w*\}/);
          if (locale !== 'ru') assert.doesNotMatch(text, /[\u0400-\u04ff]/);
        }
      }
      await page.evaluate(() => setRecipe(['u-r', 'ad-r']));
      assert.equal(await page.locator('#abilityDetail').textContent(), await translated('action.repulsion.smallDetail'));
      await page.locator('#bindSeal').click();
      await page.locator('.ability-card').click();
      assert.ok((await page.locator('#runeTooltip').textContent()).includes(await translated('action.repulsion.smallDetail')));
      await page.locator('#releaseAll').click();
      assert.equal(await page.locator('#announcement').textContent(), await translated('ability.returned.artifact', { count: 2 }));
      assert.equal(await page.locator('.piece[data-id="u-r"]').getAttribute('aria-label'), await translated('piece.add', { name: await page.evaluate(() => pieceName(byId['u-r'])) }));
    }
  });

  it('keeps six localized manuscript inscriptions on their socket axes and outside the working circle', async () => {
    await page.evaluate(() => setRecipe(['u-r', 'ad-r']));
    for (const locale of languages) {
      await choose(locale);
      const inscriptions = await page.evaluate(() => [...document.querySelectorAll('.manuscript-inscription')].map(text => {
        const label = text.querySelector('textPath');
        const arc = document.querySelector(label.getAttribute('href'));
        const midpoint = arc.getPointAtLength(arc.getTotalLength() / 2);
        const [, color, direction] = label.dataset.i18n.split('.');
        const sign = direction === 'reverse' ? -1 : 1;
        const radius = Math.hypot(midpoint.x - center.x, midpoint.y - center.y);
        const box = text.getBBox();
        return { actual: label.textContent, expected: t(label.dataset.i18n), length: text.getComputedTextLength(), available: arc.getTotalLength(),
          axisError: Math.hypot((midpoint.x - center.x) / radius - vectors[color].x * sign, (midpoint.y - center.y) / radius - vectors[color].y * sign),
          centeringError: Math.max(...Array.from({ length: text.getNumberOfChars() }, (_, index) => {
            const glyph = text.getExtentOfChar(index);
            return Math.abs(Math.hypot(glyph.x + glyph.width / 2 - center.x, glyph.y + glyph.height / 2 - center.y) - 268);
          })),
          insideField: box.x >= 0 && box.y >= 0 && box.x + box.width <= 640 && box.y + box.height <= 600,
          outsideWork: Array.from({ length: text.getNumberOfChars() }, (_, index) => {
            const point = text.getStartPositionOfChar(index);
            return Math.hypot(point.x - center.x, point.y - center.y) > 250;
          }).every(Boolean) };
      }));
      assert.equal(inscriptions.length, 6);
      for (const inscription of inscriptions) {
        assert.equal(inscription.actual, inscription.expected, locale);
        assert.ok(inscription.length <= inscription.available, `${locale}: inscription fits its sector`);
        assert.ok(inscription.axisError < .001, `${locale}: inscription names the correct socket axis`);
        assert.ok(inscription.centeringError < 1.5, `${locale}: glyphs are radially centered in the band (${inscription.centeringError})`);
        assert.ok(inscription.insideField && inscription.outsideWork, `${locale}: inscription stays in the outer band`);
      }
    }
    await page.locator('[data-theme-choice="instrument"]').click();
    assert.equal(await page.locator('#manuscriptLegend').isVisible(), false);
    assert.equal(await page.locator('.celestial-orbit').isVisible(), false);
    await page.locator('[data-theme-choice="artifact"]').click();
    assert.equal(await page.locator('#manuscriptLegend').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => [...slots]), ['u-r', 'ad-r', null]);
  });

  it('fits translated controls, cards, tooltips, and readouts on mobile and desktop', async () => {
    await page.evaluate(() => { setRecipe(['au-r', 'au-g', 'ad-b']); bindSeal(); setRecipe(['u-r', 'u-g', 'u-b']); });
    for (const locale of languages) {
      await choose(locale);
      for (const theme of ['artifact', 'instrument']) {
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          const problems = await page.evaluate(() => {
            const issues = [];
            if (document.documentElement.scrollWidth > innerWidth) issues.push('page overflow');
            const controls = [...document.querySelectorAll('.header-controls button, #languageSelect')].map(node => node.getBoundingClientRect());
            controls.forEach((box, index) => {
              if (box.left < 0 || box.right > innerWidth) issues.push('header outside viewport');
              controls.slice(index + 1).forEach(other => {
                if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1) issues.push('overlapping header controls');
              });
            });
            document.querySelectorAll('.ability-card').forEach(node => {
              const card = node.getBoundingClientRect();
              const label = node.querySelector('.ability-label').getBoundingClientRect();
              if (label.left < card.left || label.right > card.right || label.bottom > card.bottom) issues.push('card label overflow');
            });
            return issues;
          });
          assert.deepEqual(problems, [], `${locale}/${theme}/${width}`);
          if (width === 390 || width === 1440) await page.screenshot({ path: path.join(artifacts, `i18n-${locale}-${theme}-${width}.png`), fullPage: true });
        }
        await page.locator('.ability-card').click();
        const text = await page.locator('#runeTooltip').textContent();
        assert.doesNotMatch(text, /undefined|\{[A-Za-z]\w*\}/);
        if (locale !== 'ru') {
          assert.doesNotMatch(text, /[\u0400-\u04ff]/);
          for (const selector of ['.workbench', '.abilities', '.bottom-bar']) assert.doesNotMatch(await page.locator(selector).innerText(), /[\u0400-\u04ff]/);
        }
      }
    }
  });
});
