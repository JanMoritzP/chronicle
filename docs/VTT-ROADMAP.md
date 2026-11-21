# Chronicle tabletop: roadmap to a full virtual tabletop

Status: **draft for discussion**. Nothing here is built. Decisions marked "proposed" need the owner's yes before work starts. The open questions in section 10 decide the shape of phases 1 to 3.

Goal: run a complete D&D 5e game inside Chronicle (maps, tokens, vision, combat, sheets, dice, audio, handouts), with every feature Roll20 has, and then add other rule systems through data, not rewrites. Chronicle's edge over Roll20 and Foundry is that the notebook is already here: pages, monsters from the library, sessions, maps over time, relations. The tabletop should feel like the same product, not a bolt-on.

## Progress

- **Roll20 parity pass (scenes, tokens, walls, drawing): done in part.** Scene folders, notes, copies, split party, grid and ambient colour; token shapes, auras, bars, markers, action buttons, copy and paste, rolled hit points; rectangle and one-way walls, locked doors, shown areas, blindsight and truesight, moving lights; arrows, shapes, fading marks, moving drawings, pins, ping and pull. See the Roll20 checklist for what remains.
- **Phase 10, built-in map editor (first version): done.** Rooms, corridors, doors, props and lights drawn on a grid, with the walls worked out from the floor, made into a scene with its picture, walls, doors and lights, and kept so it can be edited again. Not built: freehand caves, diagonal walls, windows and secret doors, picture props, several levels, procedural dungeons.
- **Phase 8, system pack format (first version): done.** A shareable file that changes the names, conditions, damage types, initiative and grid of a world and brings roll tables, decks and macros, on top of one of the three engines; the built-in systems are packs too and can be exported as a start. Not built: packs that define their own sheets, skills, derived numbers, rolls and rest rules, and the other systems themselves.
- **Phase 7, macros, handouts, roll tables and decks (first step): done.** Saved chat lines with questions and references to the selected token, shared by the GM; handouts revealed to chosen players. Roll tables and card decks are in too (secret tables, private hands, a shared discard pile). Jukebox with looping layers, handouts from pages and a recap draft from the chat are in too. Triggers (events with fixed actions), weather and an announced turn order are in. Not built: arbitrary sandboxed GM scripts.
- **Phase 6, rules automation (first step): done.** Damage types with resistance and immunity, concentration saves, falling unconscious and death saves, short and long rests, spell slot pips and per-day uses on the table card, each rule switched on by the GM. Attacks and saves against a chosen target with the damage applied are in too, and so are spell effects that last a number of rounds and can depend on concentration. Level up (with class features from a class page), weight and attunement, reaction tracking and areas as targets are in too. Pact Magic, death saves from damage at 0 and the Pathfinder three actions are in. Not built: opportunity attacks that fire by themselves, subclass choices and feats on level up.
- **Invite links: done.** Per-world switch, links with a role, a time limit and a limit on people, a join page that makes an account or signs in, closing links, and a name for each link. E-mail invites are not built.
- **Mobile player view: first version done** (bottom bar, sheets, a hit point strip, bigger buttons). A dedicated phone sheet for characters, haptics, offline caching of the table and installable icons are not.
- **Phase 8, Pathfinder 2e (first step): done.** Per-world setting, creature sheet with action costs, threat rating by level, initiative from Perception, multiple attack penalty buttons, Pathfinder conditions with values and degrees of success. Player characters (ranks, derived numbers, strikes, spell slots) are done too. Spell lists, importing and the pack format are not built.
- **Phase 8, D&D 2024 (first step): done.** A per-world rules setting that switches encounter rating to the 2024 XP budget and the ruleset of new character sheets. The pack format itself, species and background rules and the other systems are not built.
- **Phase 2a:** model, storage and the page renderer with in-place editing are done (slices 1 to 3). Characters on the model (slice 4) are done too; retiring the old string forms (slice 5) is not.
- **Phase 0 and 1, server side: done.** `server/src/table.ts` is the table channel (WebSocket `/api/table/:world`), `server/src/tabletop.ts` holds the rules (roles, who sees and moves what, message shapes) and tables `scenes`, `tokens`, `table_state` came with the newest migration. One table per world for now (no separate `tables` row); the owner account and accounts named in the settings are GMs, world editors are players, world viewers are spectators. The server is the only writer and sends each connection only what it may see (hidden tokens reach only GMs and owners). A reconnect gets a fresh snapshot instead of a catch-up log. Messages: view, scene.create/update/delete/activate, token.add/update/move/delete, settings.set, and the short-lived cursor, ping and ruler. Test: `node scripts/smoke-table.mjs <url> gm <pass>`.
- **Phase 4, drawing: done** (pen, line, box, circle, text, colours, GM-only, eraser, clear). Tiles on three layers and the spell-area templates (cone, ray, burst, cube) are done too; user-defined layers, roof occlusion and covered-cell highlighting are not.
- **Phase 5, combat tracker: done** (order, initiative from sheets, rounds and turns, hidden combatants, turn ring). The encounter builder (creatures, party, 2014 difficulty, placing on a scene) is built too.
- **Phase 3 (core): done.** Walls (wall, door, secret door, window), fog of war with per-player memory, darkness, light sources, darkvision and sight range, per-scene settings. Light colour, vision shared between tokens and dragging wall ends are in. Universal VTT import and export is in. Missing: one-way and terrain walls, light animation. Tokens out of sight are no longer sent to players (the server filters them).
- **Phase 2 (without the full sheet overhaul): done.** Hit points, armor class, conditions, page-linked tokens with a rollable sheet card, dice and chat. Missing: editing the sheet in place, characters on the sheet model, resource tracking (slots, uses), roll cards with apply-damage buttons.
- **Phase 1: done** (scenes, grid snapping and diagonal rules, tokens, ownership, hiding, ruler, pings, cursors, panel). Documented in ROADMAP.md under Tabletop. Saved views, bringing players to a view, undo of a move and a multi-waypoint ruler are in too. Missing: scene folders.

## 1. What we already have and can reuse

| Existing piece | Reuse for the tabletop |
|---|---|
| Worlds, members, roles (`access.ts`, `workspace_members`) | The container for a campaign. Roles are too coarse for play, see section 3. |
| Page types, stat templates, special pages (Person, Monster, Location) | Actors. A character or monster sheet is a special page; a token points at one. |
| Open5e library (creatures, spells, items, classes) | Drag a monster onto a scene, build encounters, spell and item lookup in play. |
| Yjs rooms over WebSocket (`collab.ts`) | Pattern for a per-table room with presence and cursors. Not used for token state (section 2). |
| Live stream (SSE, `live.ts`), presence | Lobby, "who is at the table", fallback notices. |
| Map tiling with sharp, image upload, 600 MB limit | Scene backgrounds. Large maps already tile; scenes need a background pipeline with the same queue. |
| Maps with time, nested maps, pins | Stay as the **world maps** (lore, travel). Scenes are a different thing, see below. |
| Sessions and statistics | A game night is a session. Chat and roll log feed session notes. |
| Backup, export, copy, public share | New tables must follow the same rules (AGENTS section 3). |
| Themes, shortcuts, mobile layout | All tabletop UI must obey them. |

**Important split.** The existing Leaflet maps are for storytelling. A battle map needs per-frame canvas drawing of hundreds of tokens, walls, light and fog. Leaflet is the wrong tool. We build a separate **scene** system on a WebGL canvas and keep the world maps untouched. A scene can link to a world map pin ("this pin opens the Crypt scene") and a world map can show where the party currently is.

## 2. Architecture decisions (proposed)

1. **Rendering: PixiJS (WebGL 2, canvas fallback).** One new web dependency (about 450 KB gzipped, tree-shakable). Needed for lighting masks, fog, hundreds of sprites and smooth zoom. Alternatives considered: plain Canvas 2D (too slow for dynamic lighting at 4K), Three.js (3D we do not need), Konva (fine for drawing, weak for masks).
2. **Game state is server-authoritative, in a "table" room.** A new WebSocket route `/api/table/:tableId` with per-recipient filtering: the server never sends a player a hidden token, a GM-only layer, an unrevealed door state or a secret field. Messages are small ops (`token.move`, `token.update`, `drawing.add`, `door.toggle`) with a sequence number, applied server-side, persisted in SQLite, then broadcast. Clients apply optimistic updates and reconcile. This is not Yjs: ops need permission checks per field, and Yjs cannot hide data from some peers.
3. **Vision is computed on the client, secrets are filtered on the server.** Visibility polygons from walls are computed in a Web Worker per controlled token. The server knows walls and decides which tokens and drawings each player may receive (a coarse server-side line-of-sight check for hidden tokens, so a modified client cannot read hidden positions). Fog of war exploration is stored per player (or shared, a scene option).
4. **System-agnostic core, system packs on top.** The core knows scenes, tokens, actors, resources, conditions, dice, turn order, permissions. A **system pack** (data plus a small expression language, no arbitrary JS on the server) supplies the sheet schema, derived stats, rolls, conditions and rest rules. 5e is pack number one and is built *as* a pack from day one so nothing 5e-specific leaks into the core. See phase 8.
5. **Actors are pages.** A token links to a special page (character, monster). Linked tokens share data with the page, unlinked tokens (goblin 1 to 6) get a per-token copy of mutable fields (HP, conditions). Live HP changes can write back to the page for linked characters.
6. **Undo and an action log.** Every op is logged with who did it. GM can undo the last ops and replay "what happened". The log doubles as the session record.
7. **Units.** Scene coordinates are scene pixels. Grid size in pixels plus a distance unit (5 ft default) turn pixels into game distance. Square, hex (both orientations) and gridless from the start; the grid is not an afterthought.
8. **Everything new follows the repo rules**: append-only migrations, zod on every message, `OWNER_OF` and `sameWorld` checks, smoke script per route family, e2e per user-visible feature, backup/export/copy updated in step.

## 3. Permissions model (proposed)

Today: owner, editor, viewer per world. A table needs roles and **per-object** rules.

**Table roles:** GM (owner of the table, can have several), assistant GM (everything except deleting the table and changing permissions), player, spectator (watches, no control), and optional **observer-with-fog** for streamers.

**Per-object access levels**, as in Foundry: none, limited (sees name or image only), observer (sees everything the sheet shows), owner (controls). Applied to tokens, actors, drawings, handouts, journal pages, scenes, audio, macros.

**Capability matrix per player, set by the GM, with presets (Strict, Normal, Relaxed):**
- Move own tokens, move any token they can see, rotate, change token bars, edit own sheet, edit other sheets they observe.
- Create tokens, drag tokens from compendium, delete own tokens, upload images.
- Draw (freehand, shapes, text), erase own drawings, erase all, place pings, use ruler, place templates, share ruler with others.
- Roll dice, whisper, roll hidden, use macros, create macros, use audio, use cards.
- See other players' cursors and rulers, see the turn tracker, see roll results of others (hidden rolls are GM only).
- Per field on a token: can the players see name, bars, conditions, auras (the "players can see/edit bar" switches Roll20 has).
- Control sharing: two players share one character; a player controls a pet token; "ownership by token" versus "ownership by actor".

Enforced on the server for every op, never only in the UI. Changes to permissions take effect live (the existing `revalidateLive` pattern).

## 4. Roll20 parity checklist

Everything on this list must exist before we say "Roll20 replacement". Foundry features worth beating are marked F. Phase numbers refer to section 5.

| Area | Feature | Phase |
|---|---|---|
| **Pages and scenes** | Multiple scenes per campaign, GM can have players on different scenes ("player-ribbon", move players to scene, split the party) | 1 |
| | Scene settings: size, background image or colour, grid type and size, distance unit, diagonal rule (5-5-5, 5-10-5, Euclidean, Manhattan), grid colour and opacity, snap, scale | 1 |
| | Scene folders, duplicate scene, scene thumbnails, "start here" position, scene notes, scene permissions | 1 |
| | Page toolbar: zoom, pan, centre on token, "bring players to my view" (follow GM), save and restore camera bookmarks | 1 |
| **Layers** | Map and background layer, objects and token layer, GM layer, lighting layer, foreground and overhead layer (F), weather layer (F), per-layer visibility and lock, unlimited user-defined layers (better than Roll20) | 4 |
| | Tiles and props: placeable images that are not tokens, resize, rotate, flip, z-order, "send to back", lock, hide from players, occlude when a token walks under (roofs, F) | 4 |
| **Tokens** | Drag to move with snap, rotate, flip, resize (grid size 0.5 to N), multi-select, group move, copy and paste, z-order, lock, "bring to front" | 1 |
| | Token image, label and name plate, tint, border style, shape (round, square, hex), size by creature size (tiny to gargantuan), top-down and portrait modes, token variants (random token image from a set, F) | 1, 2 |
| | Three bars (more allowed), numeric and bar modes, bar colours, link bar to actor attribute, max value, show to GM, owners or all | 2 |
| | Status markers and conditions (Roll20 has about 50, with numbers, overlays), conditions with duration and linked effects, afflictions with rounds counter, auto-removal at end of turn | 2 |
| | Auras (circle, with colour, for radius effects), light emission, darkvision, normal vision, "see through" tokens, token faces | 2, 3 |
| | Token actions (buttons on the token that fire macros), right-click menu, hotkeys, "represents character", "default token" from actor, token mold, mook generator (random HP) | 2 |
| | Elevation and flying height indicator (F), token "path" with waypoints and drag ruler, undo move | 1 |
| | Linked and unlinked tokens, "drop onto scene from compendium" for monsters, token from page portrait | 2 |
| **Vision and light** | Walls (solid, door, secret door, window, one-way, terrain wall that blocks only movement or only sight, F), doors that open and close with a click, locked doors, draw walls with polyline and rectangle tools, snap to grid, **auto-detect walls from an image** (better than Roll20) | 3 |
| | Dynamic lighting: light sources with bright and dim radius, colour, angle, animation (torch flicker, pulse, F), shadows, light blocked by walls, light through windows | 3 |
| | Vision: normal sight, darkvision with range, blindsight, truesight, devil's sight, night vision tint, per-token vision settings, shared vision between tokens, "players see only what their tokens see" | 3 |
| | Fog of war: explored areas stay revealed (per player or shared), GM reveal and hide brush, reset fog, global illumination, daylight mode with darkness level (F), ambient light colour | 3 |
| | Advanced fog of war, "update when token drops" (Roll20 option), performance modes for slow devices | 3 |
| | Light sources as items players carry (torch, lantern, light spell) with duration, tied to the actor's inventory | 6 |
| **Drawing and measuring** | Freehand, line, rectangle, ellipse, polygon, text, arrow; fill, stroke, opacity, fill pattern; edit, move, delete; per-player colours; GM-only drawings; fade-out temporary drawings | 4 |
| | Ruler with waypoints, shared rulers visible to others, snap to grid, diagonal rules, drag ruler for movement cost, difficult terrain cost | 1, 4 |
| | Templates: cone, line, circle, square with 5e dimensions, drag from token origin, optional highlight of covered grid squares, persistent templates for lingering spells | 4 |
| | Pings (click and hold), "ping and pull" (move everyone to this spot), cursors of other players, laser pointer | 1 |
| | Text notes and map pins on the scene linking to journal or Chronicle pages, "pin cushion" icons (F) | 4 |
| **Encounters and combat** | Turn tracker with initiative, add tokens, roll for all or selected, sort, dex tiebreak, delay and ready, round counter, next/previous turn, tracker visible to players with hidden entries | 5 |
| | Encounter builder: pick monsters from library or pages, quantities, XP budget and difficulty (easy to deadly, with the party's levels), CR, group by role, save encounter, stage on a scene as pre-placed hidden tokens, "start encounter" button | 5 |
| | Encounter player: reveal group by group, reinforcements, lair and legendary action markers, per-round reminders, end-of-combat summary with XP, loot link | 5 |
| | Damage tracking on the token: apply damage and healing by clicking a roll result, temp HP, resistances, immunities, vulnerabilities, death saves on the tracker, concentration reminder | 6 |
| | Combat conditions tied to turns ("until end of next turn") and auto-expire | 5, 6 |
| | Reaction, legendary action and lair action trackers, "movement used this turn" display | 5, 6 |
| **Sheets** | Interactive 5e character sheet (all core stats, skills, saves, spells, inventory, features, death saves), roll buttons on everything, advantage/disadvantage toggles, spell slots, rests, level up | 2, 6 |
| | Monster sheet from the library with clickable attacks, saves, recharge | 2, 6 |
| | Sheets are designed as pages: sheet designer for custom sheets (data plus layout), HTML/CSS sheets are *not* supported (security), the page-type designer grows to cover it | 8 |
| | Compendium: monsters, spells, items, classes, feats, backgrounds, drag onto sheet or scene; SRD content only (OGL via Open5e); user-imported content for other material | 2, 6 |
| | Inventory with weight and encumbrance, currency, containers, attunement, charges, magic item effects that change stats | 6 |
| | Character import (D&D Beyond JSON export, Foundry actors, Roll20 export), character export | 9 |
| **Dice and chat** | Dice roller with full notation (`2d20kh1+5`, exploding, rerolls, pools, successes, `/roll`), 3D animated dice optional, roll templates (attack card, spell card) | 2 |
| | Chat with whispers, emotes, `/as` and `/emas` speaking as a token or NPC, OOC and IC channels, private GM rolls, clickable inline rolls in chat text, chat history and archive, link to session notes | 2 |
| | Roll results with apply-damage buttons, target selection, advantage state visible, crit highlight, "show roll to" options | 2, 6 |
| **Macros and automation** | Macro bar with drag from chat or sheet, per-token macro buttons, macro folders, shared macros, macro arguments, query prompts (`?{Ability|Str|Dex}`), attribute references (`@{selected|strength}`) | 7 |
| | A safe scripting layer for GMs (Roll20 API equivalent): sandboxed, event hooks (token moved, turn start, hp changed), rate-limited, per-table opt-in | 7 |
| | 5e automation: attack roll vs AC, hit and miss, auto-damage, saves for targeted tokens, area targeting from templates, spell slot spend, concentration checks, rest automation, conditions applied from effects | 6 |
| **Handouts and journal** | Handouts (text and image) reveal to selected players, in-world notes visible to some, **linked to Chronicle pages** (a page can be pushed to the table as a handout, using the existing page view) | 7 |
| | Roll tables (random encounters, loot, names), draw with or without replacement, results to chat, nested tables | 7 |
| | Card decks (Deck of Many Things, initiative cards, tarot), hands, draw, discard, reshuffle | 7 |
| **Audio** | Jukebox: playlists, loops, volume, per-scene tracks, sound triggered at a spot, audio streams from a URL, player volume control, GM broadcast to all | 7 |
| **Table and session** | Lobby, join with a link, ready check, kick, ban, mute, player colours and names, avatars, voice and video (embed a call link first, built-in WebRTC later) | 1, 9 |
| | Session recording: replay of token movement and rolls, chat archive, auto-generated recap draft in a session page | 7, 9 |
| | Camera: shared view toggle, GM spotlight, "follow token", minimap | 1 |
| | Time of day and weather tied to the Chronicle calendar (world time moves, light changes, F) | 9 |
| **Quality of life** | Keyboard shortcuts for everything, rebindable via existing `keys.ts`, touch controls (pinch, drag, long press), tablet at the table mode, left-handed layout | 1, 9 |
| | Performance targets: 60 fps with 200 tokens, 2000 wall segments, 30 light sources on a mid laptop; map up to 20000 px | 3 |
| | Backups of tables, export a scene as a portable file (Universal VTT .dd2vtt import and export for walls, lights and image, compatible with Dungeondraft and DungeonAlchemist) | 3, 9 |
| | Asset library: upload, tag and search tokens and tiles and maps, folders, bulk upload, thumbnails, free packs link, per-world storage quota | 1 |
| | Mobile player view: simplified sheet and roll UI for phones | 9 |
| **Beyond Roll20** | Regions with triggers (walk into area: play sound, show text, run macro, F), levels and multi-floor scenes with stairs, weather, tile animations (animated webm backgrounds), a map editor with room and corridor tools | 9 |

## 5. Phases

Each phase ends in something playable and shippable behind a "Tabletop" sidebar entry. Rough sizes are in weeks of focused work for one developer working with an agent; they are guesses, not promises.

### Phase 0: foundations (2 to 3 weeks)
- Concept of a **table** inside a world: `tables(id, workspace_id, name, active_scene_id, settings)` and `table_members(table_id, user_id, role)`. Default: every world member joins, owner is GM.
- The **table channel**: WebSocket route, op envelope (`seq`, `clientOp`, `ack`), per-recipient filter hook, reconnect with catch-up from `seq`, heartbeat, rate limits.
- Permission engine (section 3) as a pure module with tests, used by every op handler.
- Asset storage: `assets` table (kind, tags, size, hash), upload route (raster plus webp, svg rejected as before), thumbnail generation with sharp, dedupe by hash, quota.
- Pixi canvas shell: pan, zoom, resize, a layer stack, a ticker; an `engine/` folder under `web/src/tabletop/` with no React inside the render loop.
- Docs, smoke script, e2e scaffold.

### Phase 1: scenes and tokens, "a battle map you can play on" (4 to 5 weeks)
- Scenes with background image (reuse the tiling queue for huge maps), grid square/hex/gridless, calibrate grid by dragging, unit, diagonal rule, snap.
- Tokens: create from image, from page portrait, from asset; drag with snap, rotate, resize, lock, multi-select, group move, copy and paste, z-order, name plate.
- Ownership and visibility (hidden from players), move permissions per token, GM can move anything.
- Ruler with waypoints, pings, cursors, follow GM, camera bookmarks.
- Scene switcher, players on different scenes, scene folders.
- Optimistic movement with smooth interpolation for others' moves; undo last move.
- Table role UI: GM, assistant, player, spectator.
- Smoke: ops, permissions, reconnect. E2E: two browser contexts, one moves a token, the other sees it.

### Phase 2a: stat sheet overhaul (3 to 4 weeks, can start during phase 1)
The tabletop is only as good as the sheet. Today a Monster or Person page uses a stat block that is separate from the editor's `/statblock` node and does not follow the Open5e library shape (known caveat in AGENTS). Before tokens link to actors we fix the model:
- **One data model for creatures and characters**, shaped like the library entry (abilities, AC, HP, speeds, saves, skills, senses, languages, CR, traits, actions, reactions, legendary actions, spells, equipment). Library import becomes a straight mapping, with no lossy conversion and links kept.
- **One renderer** for the page, hover preview, token HUD and the in-play sheet, so a fix lands everywhere. A clear, readable layout with real design, in light and dark themes and at phone width.
- **Editable in place**, with computed values (modifiers, proficiency, saves, passive scores) derived, never typed twice. Computed values are still overridable.
- A migration path for existing stat blocks, tested on old data (AGENTS: old data must load).
- Result: the same sheet serves the notebook and the table. This is also the base for the system pack format in phase 8.

**Slices, in order.**
1. **Model (done).** `web/src/lib/sheet.ts`: a structured `Sheet` (numbers for abilities, AC, HP, speeds, saves, skills, senses, CR; features with usage and cost), derived values (modifiers, save totals, passive Perception, proficiency by CR), `sheetFromCreature` (Open5e) and `sheetFromLegacy` (the old string fields). `scripts/test-sheet.ts` checks that both routes give the same sheet for the same creature, including the 2024 layout.
2. **Storage (done).** `props.sheet` on the page, validated by `server/src/sheet.ts` (zod; unknown keys dropped, sizes capped). Whole sheets come with page creation or whole `props`; edits go through `propsPatch.sheet`, a map of field paths (`hp.max`, `abilities.str`, `skills.stealth`, null removes, arrays such as `features.actions` replace as a whole), so two editors changing different fields do not overwrite each other. Invalid results are refused with 400 and change nothing. Until the renderer ships, the old stat block (`props.data.main`) stays the source: changing it on the server drops a sheet made from the earlier text, and `sheetOf(props)` reads the stored sheet or converts the old block without writing. Library import of a creature writes both. Copy, history and backup carry the sheet as part of `props`; Markdown export and public pages do not show it. Tests: `scripts/smoke-sheet.mjs`, `scripts/test-sheet.ts`.
3. **One renderer.** A `SheetView` with three densities (page, hover card, token HUD) replaces `StatBlockBody` for creatures. In-place editing of numbers with derived values shown, plus overrides.
4. **Characters.** Level and classes, hit dice, proficiencies, spell slots, inventory, death saves, on the same model.
5. **Retire the old path.** The `/statblock` editor node and the string forms stay for custom templates; the built-in 5e monster forms move to the sheet.

### Phase 2: actors, live attributes, dice, chat (4 to 5 weeks)
- Actors from pages. Linked and unlinked tokens. 5e character and monster sheets rendered from the existing special page types with roll buttons. This phase builds the **resource and attribute model**: named numeric values with max, temp, and derived formulas.
- Token bars (HP, temp HP, AC display, custom), conditions with icons and rounds, auras (visual), speed, vision fields (stored, used in phase 3).
- Token HUD: click a token, change HP by typing `-7`, toggle conditions, right-click menu, hotkeys.
- Dice engine (full notation, parser with tests), chat with whispers, `/roll`, `/as`, inline rolls, roll cards for ability checks, saves, attacks, damage.
- Drag a monster from the library onto the scene (creates actor page and token).
- Compendium side panel for in-play lookup.

### Phase 3: walls, vision, lighting, fog (5 to 7 weeks) *the hard one*
- Wall tool (polyline, rectangle, snap, split, join), wall types, doors with open, closed, locked, secret states, window and one-way walls, terrain walls.
- Visibility polygons in a worker; light sources (bright, dim, colour, angle, animation); vision types and ranges; shared vision; darkness level and global illumination; light blocked by walls and doors.
- Fog of war: explored memory per player or shared, stored as a compressed mask per scene and user; GM reveal and hide brush; reset.
- Server-side filtering of hidden tokens by line of sight, performance budget in section 4.
- Wall and light import and export via Universal VTT; **auto-detect walls from image** as a stretch inside this phase.
- Performance mode and testing on a slow laptop and on a tablet.

### Phase 4: drawing, templates, layers, tiles (3 to 4 weeks)
- Drawing tools with shared live strokes (streamed points, committed on release), per-layer.
- Measurement templates with 5e shapes.
- General layer system: user-defined layers with order, visibility and lock per user, GM and player layers, foreground, tiles as a placeable object, occlusion for overhead tiles.
- Map notes and pins linking to Chronicle pages.

### Phase 5: encounters and combat (4 weeks)
- Combat tracker (initiative, turn, round, delay, ready), hidden entries, condition expiry on turn events.
- **Encounter builder**: monsters from library and pages, XP budget by party composition, difficulty meter, saved encounters in the world, stage onto a scene (tokens placed hidden), duplicate, scale up or down.
- **Encounter player**: start, reveal groups, reinforcements, lair and legendary action markers, loot and XP summary written to a session page.
- Party management: the party is a group of actors with shared inventory and gold.

### Phase 6: 5e rules automation (6 to 8 weeks)
- Attack and damage pipelines, targeting, resistances, saves, conditions applied by effects, concentration, death saves.
- Spell slots, rests, class features with uses and recharge, inventory, attunement, encumbrance, active effects that modify stats with duration.
- Level up flow, class and subclass data from the library; SRD only, gaps filled by user-entered data.
- Every automation is **off by default** and switched on per rule by the GM, so a table plays fully by hand out of the box.

### Phase 7: macros, scripting, handouts, tables, cards, audio (5 to 6 weeks)
- Macro system with queries and references. Sandboxed GM scripting with event hooks.
- Handouts and journal pushing, roll tables, card decks, jukebox and ambient sounds, session recap draft.

### Phase 8: multi-system (4 to 6 weeks for the framework, then 2 to 3 weeks per system)
- System pack format: sheet schema, derived stat expressions, roll definitions, conditions, rests, grid defaults, XP and difficulty rules, compendium mappings.
- Port 5e into the pack format first, then **D&D 2024** as a variant of it, then **Pathfinder 2e** (three actions, degrees of success). Later candidates, unordered: Call of Cthulhu / BRP, Shadowrun, Savage Worlds, Fate, Blades in the Dark.
- Sheet designer in the page-type designer; pack import and export so the community can share.

### Phase 9: polish and extras (ongoing)
- Importers (Foundry, Roll20, D&D Beyond, Universal VTT), recording and replay, weather, regions and triggers, levels, animated backgrounds, voice and video, mobile player view, tablet mode, accessibility (colour-blind token markers, keyboard-only token moves, screen reader labels for the tracker).

### Phase 10: built-in map editor (much later)
Rooms, corridors, doors, props, tile sets and lighting drawn inside Chronicle, producing scenes with walls and lights already placed. Also: zoom into a world-map pin to start a scene, procedural dungeons if wanted. Not scheduled; uploaded maps cover play until then.

### Mobile player view (runs through phases 1 to 9)
A phone layout for players, installable as a PWA: own sheet, dice, own token with move and HP, initiative order, chat, handouts, a simple scene view with pinch zoom. Every new tabletop feature ships with its phone behaviour defined, as the repo rules already require phone-width layouts.

## 6. Data model sketch (new tables, all per world)

`tables`, `table_members`, `scenes` (grid, background asset, walls json or table, darkness, settings), `scene_walls`, `scene_lights`, `scene_tokens` (actor_page_id nullable, x, y, rotation, size, layer, hidden, vision, light, bars, conditions, overrides json), `scene_drawings`, `scene_tiles`, `scene_notes`, `scene_fog(scene_id, user_id|shared, mask)`, `assets`, `actors_overrides`, `combats`, `combatants`, `encounters`, `chat_messages`, `roll_log`, `macros`, `roll_tables`, `decks`, `handouts`, `playlists`, `table_ops` (the op log, trimmed after snapshots), `system_packs`.

Rules that apply: migrations append only; backup restore, export and copy get updated in the same change; `access.ts` `OWNER_OF` extended; the public share path must never expose table data.

## 7. Cross-cutting concerns

- **Security.** Server validates every op against the permission engine. No user-supplied code on the server. GM scripts run in a sandbox (Web Worker on the GM's client first; server-side scripting only if there is a strong reason). Upload allow-list stays raster only; audio gets its own allow-list (mp3, ogg, wav, m4a) with size limits.
- **Bandwidth and scale.** One table is a handful of people. Target 8 players, 4 MB scene state, ops under 500 bytes. Large tile sets and fog masks load as binary, not JSON. SQLite handles it; ops are batched.
- **Offline and reconnect.** The table must survive a flaky connection: reconnect, catch up from `seq`, show a banner when behind.
- **Content licensing.** Only SRD 5.1 and CC-BY content ships (Open5e). No non-SRD WotC content. Importing user-owned content is the user's responsibility; no marketplace for copyrighted material.
- **Testing.** Op engine and permission engine as pure functions with tests; two-browser e2e for every live feature; a headless bot player for load tests; visual regression screenshots for lighting.
- **Desktop app.** Electron already loads the server UI, so the tabletop ships without a new desktop build, unless we add native features (local audio, screen share).
- **Docs.** A "Tabletop" section in `docs/ROADMAP.md` per shipped phase, a GM guide in the in-app Manual, `features.yml` entries.

## 8. Risks

1. **Lighting and fog performance** on weak hardware is the biggest technical risk. Mitigation: worker polygons, a fixed-cost shader approach, a "simple fog" mode.
2. **Scope.** This is years of work for a team. Mitigation: ship playable slices each phase, 5e only until phase 8, keep automation optional.
3. **Server authority vs. hidden info** makes naive "send everything and hide it in the client" tempting. Mitigation: per-recipient filtering from phase 0.
4. **Rules content licensing** limits what the compendium can contain.
5. **Single SQLite process** limits hosting to modest groups. That is fine for self-hosted tables; document the limits.

## 9. First milestone proposal

"Two people, one scene, tokens that move live with a ruler and pings" is phases 0 and 1. It is the smallest thing that proves the architecture and is already useful for theatre-of-the-mind groups that only need a map.

## 10. Decisions from the owner (2026-11-19)

| Topic | Decision |
|---|---|
| Renderer | PixiJS for scenes. Leaflet world maps stay as they are. |
| Rules automation | Optional and **off by default**. Sheets and dice work fully by hand; the GM switches automation on per rule. |
| Table size | 8 players is the design target, **not a hard cap**. Nothing may assume a fixed number. |
| Hosting | Later the app will run in small clusters with small backends. Not designed for now: one process, SQLite. We still keep room state, storage and assets behind thin modules so a later move is a refactor, not a rewrite. |
| Order | Phase 0 and 1, then **phase 2 (actors, HP, dice, chat)**, then vision. |
| Stat sheet | The current stat sheet is ugly and does not match the library data. An **overhaul is a prerequisite** of phase 2, see "Phase 2a". |
| Systems | After 5e: **D&D 2024 rules** first (a variant pack, cheap), then **Pathfinder 2e**. |
| Mobile | A **mobile-first player view** (phone: sheet, dice, own token, initiative) is a design constraint from phase 1, not a phase-9 extra. |
| Battle maps | Uploaded images first. A **built-in map editor** comes much later (phase 10). |
| Not wanted now | Built-in voice and video (link a call instead), public lobby and streaming, AI helpers. Parked, not rejected. |

## 11. Decisions, second round

| Topic | Decision |
|---|---|
| Sheets | A **dedicated sheet view** with its own layout, used by the page, hover preview, token HUD and table. Notes stay in the editor below it. Phase 2a builds it. |
| Joining | **Both** (invite links are built, see ROADMAP.md "Invite links"): admin-created accounts stay, plus optional invite links a GM can switch on per world. Needs a signup path and an auth review before it ships (AGENTS: ask before changing auth). |
| Dice | Animated numbers first. 3D dice may follow as an option. |
| Fog | Memory is **per player** by default, switchable per scene. |
| Grid | Diagonals default to **5-10-5**, switchable per scene. |
| Assets | **Local uploads only.** No bundled token or map packs, so no licensing or download-size concerns. |

## 12. Still open

1. Anything missing from the Roll20 parity table that you use at your own table?

## What is still missing, by phase

Spatial sound (sound that fades with distance) is cut. Arbitrary GM scripts stay out on purpose. Everything else not built yet is numbered here and done in this order.

1. **Rules at the table.** Opportunity attacks (done). Drag ruler with movement cost and difficult terrain. Roll templates (attack and spell cards). Subclass and feat choices on level up.
2. **Map and light.** User-defined layers. Light angle (cones). Light through windows. Night vision tint. Terrain walls.
3. **Sheets.** Sheet designer and custom-sheet packs. Compendium drag onto a sheet. Containers for inventory. Magic item effects beyond armor class. Light sources as inventory items.
4. **More systems.** Further rule systems after D&D 5e, 2024 and Pathfinder 2e. Pathfinder spell lists and importing. 2024 species and backgrounds.
5. **Table comfort.** Rebindable table shortcuts. Dragging macros from chat and sheets. Linking chat to session notes. Playlists. "See through" tokens. Fog update on drop and performance modes. Performance measurement.
6. **Time and places.** Time of day tied to the calendar. Levels and stairs. Animated backgrounds.
7. **Map editor extras.** Freehand caves, diagonal walls, windows and secret doors, picture props, procedural dungeons.
8. **People.** Voice and video. E-mail invites. 3D dice.
