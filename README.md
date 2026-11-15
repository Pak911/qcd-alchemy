# QCD Alchemy

An interactive experiment in building an intuitive magic system from ideas in quantum chromodynamics (QCD), the theory of the strong interaction. It is also a simplified visual model for exploring quark combinations, color balance, and electric charge.

The same rules have two presentations: **Alchemy**, where you assemble magical seals from symbolic stones, and **Quark Model**, where you work directly with quarks, antiquarks, and examples of particles with the resulting composition.

## Where the idea came from

This project started with a thought: gameplay is often about solving a problem, whether that means understanding a system, finding a useful combination, or working within constraints. Could a scientific theory provide the underlying system for that kind of play?

Quantum chromodynamics seemed like an interesting challenge precisely because it is so mathematical and difficult to approach intuitively. The question became: **could a magic system make some of its structure understandable through interaction, without requiring the player to start with the equations?**

The aim is to preserve meaningful scientific relationships while simplifying the model enough to explore by hand. In the alchemical presentation, symbols, spatial balance, motion, and sound provide feedback. Switching to Quark Model reveals the scientific interpretation of the same pieces and combinations.

This is a prototype for exploring that idea.

## Two ways to explore

### Alchemy

Combine stones on an alchemical circle to complete seals. Three families of planetary signs stand for the three color charges; their reversed signs stand for anticolors. The resulting electric charge maps to five fictional actions: Compression, Attraction, Holding, Repulsion, and Dispersion.

Completed seals can be placed in a six-slot ability panel. Their ingredients remain reserved until you dismantle them, so building a set of abilities becomes a small resource-allocation problem. The prototype just describes these abilities but does not implement them.

### Quark Model

Select the second presentation, **Quark Model**, to use the prototype as a simplified, interactive model of selected ideas from quantum chromodynamics rather than as a magic-system sandbox.

- Explore up and down quarks and their antiquarks in three colors or anticolors.
- Compare fractional electric charges and the total charge of a composition.
- Assemble matching color-anticolor pairs, or triples containing all three colors or all three anticolors.
- See how these combinations relate to mesons, baryons, and antibaryons.
- Inspect examples of real particles with the corresponding valence-quark composition.

Both presentations share the same state. Switching between them does not discard the current composition or the ingredients reserved in the panel.

## Try it

[Explore QCD Alchemy in your browser](https://pak911.github.io/qcd-alchemy/). No download or installation required.

1. Choose **Alchemy** or **Quark Model** at the top of the page.
2. Select inventory pieces or empty sockets to add up to three components to the circle.
3. Try a quark with an antiquark of matching color, or three quarks of different colors. Three antiquarks of different anticolors also form a valid combination.
4. Inspect the result, then save the completed composition to the panel or remove pieces to try another one.
5. Use the random pair and triple controls to discover examples. Dismantle saved compositions to recover their ingredients.

Hover or focus a piece to inspect it; on touch screens, use a long press. Sound can be turned off.

The current prototype supports **English, Spanish, Brazilian Portuguese, Simplified Chinese, and Russian**, with automatic selection from the browser language and an English fallback. Language and presentation preferences are stored locally when browser storage is available. Compositions are session-only and reset on reload.

## What the model does and does not represent

The prototype keeps the fractional electric charges of up/down quarks and antiquarks, distinguishes color from electric charge, and uses simplified rules for color-neutral quark-antiquark pairs and three-quark or three-antiquark combinations. An integer electric charge alone is not enough to make a valid combination.

Its scope is deliberately limited:

- Only up/down flavors and their antiparticles are included, with one inventory piece for each flavor/color combination and a maximum of three pieces in an assembly.
- Color is drawn as a two-dimensional balance diagram. This is a visual aid, not the full quantum description of color-singlet states.
- There is no calculation of gluon dynamics, confinement, mass, energy, spin, or particle decay.
- A valence-quark composition does not uniquely identify a particle. The interface gives examples; neutral up-antiup and down-antidown pairs are described as components of superpositions, not complete neutral-meson identifications.
- Magical effects, planetary associations, animated strings, and sounds are design metaphors, not physical predictions.

Use it to build intuition about a small set of combination rules, not to calculate experimental results or replace a treatment of QCD. For broader context, see [CERN's introduction to the Standard Model](https://home.cern/science/physics/standard-model).

## Project structure

- `qcd_magic_prototype.html`: the working application, including its CSS, JavaScript, translations, SVG graphics, and synthesized audio.
- `versions/`: an interactive gallery of the design thought process, documenting the problems explored, the approaches tried, and the steps that led from one iteration to the next. Each stage preserves a working snapshot.
- `tests/`: browser-driven tests for rules, interaction, presentation, localization, and history navigation.
- `scripts/build-site.mjs`: packages the public site into `_site/` without changing the source HTML.
- `.github/workflows/pages.yml`: runs tests and deploys the site to GitHub Pages from the default branch.
- `package.json` and `package-lock.json`: development-only test tooling.
- `AGENTS.md`: project conventions for automated coding assistants, including test groups and snapshot handling.

The application has no runtime package dependencies, remote assets, analytics, accounts, or backend. Playwright and Chromium are needed only for development tests. Generated browser binaries, dependency installations, caches, and test artifacts are excluded from Git.

## Development and tests

Use a supported Node.js LTS release, version 22 or newer, and npm. Tests use Node's built-in test runner with Playwright Chromium, not the Playwright Test runner.

Install dependencies and Chromium from the project directory. The tests expect browser binaries in the project-local `.browsers` directory.

**PowerShell:**

```powershell
npm --cache ".npm-cache" ci
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.browsers"
npx --cache ".npm-cache" playwright install chromium
npm --cache ".npm-cache" test
```

**Bash:**

```bash
npm --cache ".npm-cache" ci
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx --cache ".npm-cache" playwright install chromium
npm --cache ".npm-cache" test
```

On a fresh Linux CI runner, use `playwright install --with-deps chromium` with the same `PLAYWRIGHT_BROWSERS_PATH` setting to install the required system libraries as well.

For focused work, run the relevant group:

- `npm --cache ".npm-cache" run test:rules`: combination rules and core interaction.
- `npm --cache ".npm-cache" run test:abilities`: seals, reservations, ability panels, and descriptions.
- `npm --cache ".npm-cache" run test:ui`: scientific vocabulary, the named scale, and touch inspection.
- `npm --cache ".npm-cache" run test:layout`: geometry, focus, animation, and responsive layouts.
- `npm --cache ".npm-cache" run test:history`: archived snapshots and gallery navigation.
- `npm --cache ".npm-cache" run test:i18n`: language selection, translations, and localized layouts.
- `npm --cache ".npm-cache" run test:site`: static-site packaging and the public file allowlist.

Tests write temporary files and screenshots to `.artifacts/`. Current automated browser coverage uses Chromium; it is not a claim of testing every browser or physical device.

Run `npm --cache ".npm-cache" run build` to package the site. This recreates the generated `_site/` directory with only the public files. GitHub Actions runs the full test suite on pull requests and pushes to `main` or `master`; deployment is restricted to the repository's default branch. In the repository's **Settings > Pages**, select **GitHub Actions** as the publishing source.

## License

Released under the [MIT License](LICENSE), copyright (c) 2026 pak911.

If you use this project or build on its ideas, please credit [pak911](https://github.com/pak911) and link to [QCD Alchemy](https://github.com/pak911/qcd-alchemy). This is just a friendly request, not an additional license condition. The MIT requirements to preserve the copyright and license notices still apply when distributing copies or substantial portions of the software.
