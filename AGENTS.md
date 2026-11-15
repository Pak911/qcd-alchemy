# Project Scope

- Keep file inspection and changes inside this QCD project directory. Do not search parent directories or neighboring projects without explicit user approval.

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
