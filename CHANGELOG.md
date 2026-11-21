# Changelog

Newest first. The version in `electron/package.json` is the app version; the release notes on GitHub are what the in-app update dialog shows, so keep each entry short and in plain words. Sections after 0.2.0 are written by `scripts/release.mjs` from the commit subjects, so the commit messages carry the release notes.

## 0.36.0 (2026-11-21)

### Features
- the GM can let the table apply 5e rules: damage types, concentration, death saves, rests and spell slots

## 0.35.0 (2026-11-21)

### Features
- players are no longer sent tokens they cannot see in fog, darkness or behind walls

## 0.34.0 (2026-11-21)

### Features
- invite links, so players can join a world by opening a link

## 0.33.2 (2026-11-19)

### Bug Fixes
- the order of play shows each name next to its initiative box

## 0.33.1 (2026-11-19)

### Bug Fixes
- changing someone's access in the admin dashboard no longer resets everyone's open tabletop

## 0.33.0 (2026-11-19)

### Features
- Pathfinder 2e player characters with ranks, derived numbers and strikes

## 0.32.0 (2026-11-19)

### Features
- Pathfinder 2e as a rules choice, with creature sheets, threat levels and degrees of success

## 0.31.0 (2026-11-19)

### Features
- the tabletop works on a phone with a bottom bar and a hit point strip

## 0.30.0 (2026-11-19)

### Features
- choose D&D 5e 2014 or 2024 rules for a world

## 0.29.1 (2026-11-19)

### Bug Fixes
- the tabletop works again after updating from an earlier version, scenes can be created

## 0.29.0 (2026-11-19)

### Features
- tiles on three layers and spell area templates on the tabletop

## 0.28.0 (2026-11-19)

### Features
- player characters get a full sheet on their person page

## 0.27.0 (2026-11-19)

### Features
- a monster page shows and edits its creature as a real sheet

## 0.26.0 (2026-11-19)

### Features
- encounters and drawing on the tabletop

### Bug Fixes
- the tabletop only paints while something changes

## 0.25.0 (2026-11-19)

### Features
- a combat tracker with initiative, rounds and turns on the tabletop

## 0.24.0 (2026-11-19)

### Features
- walls, doors, light and fog of war on the tabletop

## 0.23.0 (2026-11-19)

### Features
- tokens have hit points and conditions, and the table has chat and dice

## 0.22.0 (2026-11-19)

### Features
- a tabletop where the GM and players share a scene with tokens that move live

## 0.21.0 (2026-11-19)

### Features
- settings are now split into sections (appearance, shortcuts, worlds, sharing, accounts, backups, my account) with a menu on the left, or tabs on a phone

## 0.20.2 (2026-11-19)

### Bug Fixes
- words from a page imported from the library no longer count as words you wrote in the session stats

## 0.20.1 (2026-11-19)

### Bug Fixes
- scroll the world list in the sidebar menu when you have many worlds

## 0.20.0 (2026-11-19)

### Features
- switch worlds from the sidebar, and a calmer look with a Home that picks up where you left off

## 0.19.0 (2026-11-19)

### Features
- close an open brace for you when you press Enter on a chain like /h2{Heading

## 0.18.0 (2026-11-19)

### Features
- leave a comment for someone by typing @ and their name, with a Comments tab and a count in the sidebar

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
