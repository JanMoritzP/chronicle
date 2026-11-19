# Changelog

Newest first. The version in `electron/package.json` is the app version; the release notes on GitHub are what the in-app update dialog shows, so keep each entry short and in plain words. Sections after 0.2.0 are written by `scripts/release.mjs` from the commit subjects, so the commit messages carry the release notes.

## 0.17.0 (2026-11-19)

### Features
- add a built-in manual, list every command when you type / and explain chain text in braces

## 0.16.0 (2026-11-19)

### Features
- add a Check for updates button to the desktop app's Settings and address screen

## 0.15.1 (2026-11-19)

### Bug Fixes
- show people coming online and leaving on the admin dashboard straight away instead of on a timer

## 0.15.0 (2026-11-19)

### Features
- add note, warning, read-aloud and secret boxes, collapsible sections, columns, a contents list, roll tables and NPC, place and encounter starters to the slash menu

## 0.14.0 (2026-11-19)

### Features
- chain blocks in the slash menu, e.g. /h2{Plot hooks}+ul>li*3 inserts a heading and a three item list

## 0.13.0 (2026-11-19)

### Features
- see who changed a page and when, and restore any earlier version of it, including its fields, tags and portrait

## 0.12.1 (2026-11-19)

### Bug Fixes
- reach the admin dashboard from other machines on your network when running with Docker Compose

## 0.12.0 (2026-11-19)

### Features
- let several people edit a world together, with an admin dashboard for who can open which world

## 0.11.0 (2026-11-18)

### Features
- show a preview card when you hover a link to a library entry

## 0.10.0 (2026-11-18)

### Features
- link the names of library entries inside text

## 0.9.1 (2026-11-18)

### Bug Fixes
- start the desktop build after every automatic release

## 0.9.0 (2026-11-18)

### Features
- link weapon properties, damage types, spell schools and creature types from library entries

## 0.8.0 (2026-11-18)

### Features
- give every library entry its own special page and let stat block forms hold links

## 0.7.0 (2026-11-18)

### Features
- link class, species, spells and more from special page fields

## 0.6.0 (2026-11-18)

### Features
- link pages to library entries and move those links when you import one

## 0.5.0 (2026-11-18)

### Features
- search the Open5e library and add creatures, spells and items to a world

## 0.4.0 (2026-11-18)

### Features
- start new pages with a todo, delete worlds, design real stat blocks and wrap page text

## 0.3.0 (2026-11-05)

### Features
- design special page layouts in a visual designer

## 0.2.0

- **Desktop app updates itself.** It checks GitHub for a new version shortly after start and every six hours. The installed app downloads and installs the update; the portable app downloads the new exe and swaps itself on restart. `Ctrl+Shift+U` (or "Check for updates" on the address screen) checks right away.
- Special pages: Person, Monster, Location and your own types, with fully custom layouts and stat block forms.
- Fixed: creating a page, special page, folder or quick capture with no world showed "not found" and a TypeError. It now asks you to create your first world.
- In-app dialogs instead of the browser's native ones, styled dropdowns, drag and drop into folders, a font setting.

## 0.1.0

First build.
