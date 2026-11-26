# What Chronicle is still missing

A comparison with Roll20, LegendKeeper and D&D Beyond, made on 2026-11-26 from the code and the two roadmaps. The tabletop is close to Roll20 parity (see `VTT-ROADMAP.md`); the real gaps are in what players are allowed to see, in moving into Chronicle from another tool, and in a few player-facing comforts. Items are ordered by how much they matter, inside each group.

Status: **planned** (nothing built), **started** (work in progress), **built** (see the section in `ROADMAP.md`).

## 1. Keeping things from players

This is what LegendKeeper and World Anvil are built around, and the largest gap.

| Gap | What was found | Status |
|---|---|---|
| Secret boxes reach every member | The `secret` callout is only removed from public share links (`publicDoc` in `routes/shares.ts`). `GET /api/pages/:id`, the live editing room and the page text in the bootstrap send it whole to every member of the world, so a player reads every secret. | built |
| No page or folder permissions | Every member sees every page. There is no "GM only", no "only Alice", no "reveal later". Handouts do this at the table but not in the notebook. | built |
| Only two world roles | A member is an editor or a viewer. There is no co-GM role in the notebook: table GMs are a separate list in the table settings. | built |
| Search, links and the graph follow the pages | Once pages can be hidden, the bootstrap (search, graph, backlinks, tags), embeds, hover previews, history, comments, todos, the trash, map pins, events and relations must leave them out too, or the hidden page leaks through them. | built |
| Map pins and timeline events | A pin or an event can not be hidden on its own, only through the page it points at. | planned |

## 2. Moving in from other tools (LegendKeeper, World Anvil, Obsidian)

| Gap | What was found | Status |
|---|---|---|
| No importer | `ROADMAP.md` lists import (Affine, Logseq, World Anvil) as "not done, low priority". Only Chronicle's own world backup, Universal VTT scenes and character files (Foundry, D&D Beyond, Pathbuilder) can be read in. Being able to bring an existing campaign along is what decides whether people switch. | built (LegendKeeper, World Anvil and Roam not checked against real exports) |
| Copying between worlds is partial | Map pins, events, history, templates and custom page types are not carried. | planned |

## 3. LegendKeeper

| Gap | What was found | Status |
|---|---|---|
| Boards | No free canvas for plot webs, mind maps or session planning. Graph and Relations are computed, not laid out by hand. | planned |
| Live world maps | An open Leaflet map does not follow another person's edits to its pins. | planned |
| Offline writing | Reading works offline; edits are only kept while the tab stays open, and the service worker is a stub. | planned |
| Covers on shared pages | Shared pages do not show the cover picture. | planned |

## 4. D&D Beyond

| Gap | What was found | Status |
|---|---|---|
| Phone character sheet | The mobile player view exists, but the dedicated phone sheet is listed as not built. This is the most used part of D&D Beyond. | planned |
| Guided character creation | The builder exists; a step by step path for new players (point buy, standard array or rolled scores, spells from the class list, starting equipment or gold) should be checked against it. | planned |
| Class spell lists | Spells on a sheet are text lines. No list of a class's spells to pick from, no prepared and known rules. | planned |
| Party overview | No GM screen outside the table with the whole party's hit points, armor class, passive Perception and conditions. | planned |
| Content beyond the SRD | Open5e and homebrew are as far as the license allows. A hard limit, not a task. | not planned |

## 5. Roll20

| Gap | What was found | Status |
|---|---|---|
| Difficult terrain | The only open item on the VTT list: double movement cost on the drag ruler. | planned |
| More rule systems | Packs cannot yet bring their own sheets, skills, derived numbers and rests. | planned |
| GM scripts | Left out on purpose; triggers and macros cover most uses. | not planned |
| Group finding, marketplace | Out of scope for a self-hosted app. | not planned |

## 6. Operations and reach

| Gap | What was found | Status |
|---|---|---|
| Two-factor sign-in | None. Matters more now that invite links let strangers make accounts. | planned |
| Translations | The UI is English only, with no translation layer. | planned |
| Printing | No print or PDF view for pages and sheets. | planned |
| One table per world | A second group in the same world needs a second world. | planned |
| Platforms | Only amd64 images; the Linux and Mac desktop builds are untested. | planned |

## Order of work

1. Permissions (built, see "Who sees what" in `ROADMAP.md`): a GM role in worlds, access per page and per folder, secrets hidden from players, and every place that lists pages filtered by the same rule.
2. An importer (built, see "Import from other apps" in `ROADMAP.md`) that reads Obsidian vaults, plain Markdown folders, Notion, Logseq, LegendKeeper, World Anvil, Roam, HTML and text.
3. Then, by value: the phone sheet, boards, class spell lists, two-factor sign-in.
