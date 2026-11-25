# Library files

A homebrew library travels between Chronicle servers as one JSON file, `<name>.chronicle-library.json`. Chronicle writes it with **Export** on a library's page in the Library view, and reads it with **Import a library file** (the arrow next to "Your libraries"). The file can also be written by hand or by another program; this page describes it.

## The file

```json
{
  "format": "chronicle-library",
  "version": 1,
  "library": {
    "id": "sunken-coast",
    "name": "Homebrew of the Sunken Coast",
    "description": "Classes, peoples and gods of the coast campaign.",
    "author": "Jan",
    "license": "CC BY 4.0"
  },
  "entries": [ ... ],
  "assets": { "a1": "data:image/png;base64,iVBORw0..." }
}
```

- `format` and `version` must be exactly these.
- `library.id` is lower case letters, digits and hyphens (up to 80). It names the library on the server: importing a file whose id is already there asks whether to **replace** that library. Replacing keeps the entries' keys, so links to them keep working, and removes entries the file no longer has.
- `assets` holds the pictures the entries use, as `data:` URLs (PNG, JPEG, WebP, GIF or AVIF). An entry refers to one as `"asset:<name>"`, for example `"portrait": "asset:a1"`. Optional.
- A file may be up to 64 MB and hold up to 5000 entries.

## An entry

```json
{
  "id": "storm-knight",
  "category": "class",
  "name": "Storm knight",
  "sub": "Class · d10 hit die",
  "type": "class",
  "fields": { "hit_die": "d10" },
  "rules": { "die": 10, "primary": ["str"], "saves": ["str", "con"], "skills": { "count": 2, "from": ["athletics", "perception"] },
             "armor": { "base": 16, "dex": "none", "note": "chain mail" },
             "features": [{ "name": "Thunder strike", "text": "Once per turn, 1d6 thunder damage." }],
             "attacks": [{ "name": "Longsword", "ability": "str", "damage": "1d8", "note": "slashing" }],
             "kit": [{ "name": "Chain mail", "equipped": true }] },
  "text": "# Origins\nKnights who ride the storm.\n\n- Sworn to the sea\n- Feared by sailors",
  "portrait": "asset:a1",
  "tags": ["homebrew"]
}
```

| Field | Meaning |
|---|---|
| `id` | Its name inside the library (as `library.id`). Made from the name when missing. Keep it stable: it is the entry's key on the server (`class:hb.sunken-coast.storm-knight`). |
| `category` | `creature`, `spell`, `magicitem`, `item`, `class`, `species`, `background`, `feat`, `condition`, `weaponproperty`, `damagetype`, `skill`, `ability`, `school`, `language`, `creaturetype`, `alignment`, `size`, `rule`, or `page` for anything else (a place, a god, lore). Required. |
| `name` | Required, up to 200 characters. |
| `sub` | The short line next to the name in search results. |
| `type` | The special page type the page becomes in a world. Defaults to the one of the category (creature: Monster, magicitem and item: Item, and so on; `page` becomes a plain page). A custom type that the world does not have falls back to the default. |
| `fields` | The page's field values (`props.data`). A stat block lives under `main` as `{ "template": "5e-monster", "data": { ... } }`. |
| `sheet` | A creature or character sheet, as Chronicle stores it. |
| `rules` | For `class`, `species` and `background`: what the character builder needs (below). |
| `content` | The page text as a TipTap document (what Chronicle exports). |
| `text` | Plain text for files written by hand, used when there is no `content`: `#` headings, `-` lists, `**bold**`, `*italic*` and `|` tables. |
| `portrait` | A picture: an `asset:` name, or a URL. |
| `tags` | Tags the page gets. |

## Rules for the character builder

Values out of range are clamped and unknown skills dropped when the rules are read.

Without `rules`, the builder still offers a class, species or background, with rules worked out from its `fields` (`hit_die`, `saves`, `primary`) and defaults for the rest.

**Class.** `die` (6, 8, 10 or 12), `primary` (up to two abilities: `str`, `dex`, `con`, `int`, `wis`, `cha`), `saves` (two abilities), `skills` (`count` and `from`: a list of skill names in lower case, or `"any"`), `spell` (the spellcasting ability, or empty), `caster` (how its spell slots grow: `full`, `half`, `third` or `pact`; `full` when it casts and this is missing), `subclassLevel` (the class level of its subclass, 3 when missing), `armor` (`base`, `dex`: `full`, `max2` or `none`, `plus`: another ability, `shield`: true for +2, `note`), `features` and `attacks` (`ability`: `str`, `dex` or `finesse`, `damage` like `1d8`), `kit` (`name`, `qty`, `weight`, `equipped`), `spells` (text for the sheet).

**Species.** `size` (`Tiny`, `Small`, `Medium`, `Large`), `speed`, `darkvision` (feet), `languages`, `asi` (2014 rules: the scores it raises, `{ "wis": 2 }`), `freeAsi` (2014: how many more scores the player raises by 1), `hpPerLevel`, `skills`, `traits`.

**Background.** `skills` (two), `tools`, and for the 2024 rules `abilities` (the three scores it may raise) and `feat`.
