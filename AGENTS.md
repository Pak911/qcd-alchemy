# Project Scope

- Keep file inspection and changes inside this QCD project directory. Do not search parent directories or neighboring projects without explicit user approval.

# Test Scope

- During iteration, run the smallest relevant test selection. Do not run the full suite after every copy, styling, or isolated interaction change.
- Use `node --test --test-name-pattern="test name or regex" tests/prototype.test.mjs` for individual checks. Include affected transitions and mode switches, not just the changed happy path.
- Use `npm --cache ".npm-cache" run test:rules` for combination rules and core interaction.
- Use `npm --cache ".npm-cache" run test:abilities` for seals, reservations, ability panels, and descriptions.
- Use `npm --cache ".npm-cache" run test:ui` for vocabulary, the named scale, and touch inspection.
- Use `npm --cache ".npm-cache" run test:layout` for seal geometry, focus synchronization, animation, and responsive layouts.
- Use `npm --cache ".npm-cache" run test:history` for snapshots and gallery navigation. Skip this group when only the working prototype changes.
- Use `npm --cache ".npm-cache" run test:i18n` for language selection, translations, localized layouts, and preserving state across language changes.
- Use `npm --cache ".npm-cache" run test:site` for static-site packaging and the public file allowlist.
- Run the full `npm --cache ".npm-cache" test` before a user-authorized commit and after broad changes whose impact crosses groups or is uncertain. Commit permission is still required separately.
- Keep new tests in the appropriate named suite and update the npm group filters when suites are renamed or added, so no suite falls outside the grouped commands.
- Report which selection ran; do not describe a focused pass as a full-suite pass. Check screenshots for visual changes when useful.

# Prototype Version History

- Edit `qcd_magic_prototype.html` for ongoing experiments. Let the user review changes before committing.
- Before a user-authorized commit of a new prototype iteration, copy the approved working HTML into `versions/` using the next unused numeric prefix and a short descriptive name.
- Use descriptive English names for snapshot filenames and technical history IDs, not transliterated localized titles. Keep user-facing names independently localizable.
- Make an actual filesystem copy. Do not recreate the large HTML file through a patch, generated replacement text, or manual transcription.
- Verify that the new snapshot is byte-identical to the working prototype. Never overwrite or revise existing historical snapshots.
- Add the new step to `versions/history-data.js`: ID, file, title, short description, motivating question, and concise changes.
- Ensure `versions/index.html` lists and opens the new step. Update the archive tests and navigation assumptions for the added version.
- Keep archive metadata focused on the gallery; do not add stored checksums, provenance fields, or tests for them.
- Include the approved prototype, its snapshot, history metadata, and relevant tests in the same commit.
- Do not add snapshots for every exploratory edit or for gallery-copy-only changes. If the latest snapshot already matches the approved prototype, do not duplicate it.
- Commit, amend, or push only when explicitly requested by the user.
