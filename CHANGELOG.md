# Changelog

Newest first. The version in `electron/package.json` is the app version; the release notes on GitHub are what the in-app update dialog shows, so keep each entry short and in plain words. Sections after 0.2.0 are written by `scripts/release.mjs` from the commit subjects, so the commit messages carry the release notes.

## 0.2.0

- **Desktop app updates itself.** It checks GitHub for a new version shortly after start and every six hours. The installed app downloads and installs the update; the portable app downloads the new exe and swaps itself on restart. `Ctrl+Shift+U` (or "Check for updates" on the address screen) checks right away.
- Special pages: Person, Monster, Location and your own types, with fully custom layouts and stat block forms.
- Fixed: creating a page, special page, folder or quick capture with no world showed "not found" and a TypeError. It now asks you to create your first world.
- In-app dialogs instead of the browser's native ones, styled dropdowns, drag and drop into folders, a font setting.

## 0.1.0

First build.
