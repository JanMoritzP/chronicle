import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

fs.mkdirSync(config.dataDir, { recursive: true })
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true })

export const db = new Database(path.join(config.dataDir, 'dnd.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const migrations: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    icon TEXT,
    aliases TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    text TEXT NOT NULL DEFAULT '',
    outline TEXT NOT NULL DEFAULT '[]',
    props TEXT NOT NULL DEFAULT '{}',
    word_count INTEGER NOT NULL DEFAULT 0,
    has_stats INTEGER NOT NULL DEFAULT 0,
    source_zettel_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX pages_ws ON pages(workspace_id, deleted_at);
  CREATE TABLE page_tags (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (page_id, tag)
  );
  CREATE TABLE links (
    source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_id TEXT,
    target_name TEXT NOT NULL,
    anchor TEXT,
    embed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX links_source ON links(source_id);
  CREATE INDEX links_target ON links(target_id);
  CREATE TABLE page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX versions_page ON page_versions(page_id, created_at);
  CREATE TABLE zettels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
    processed_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE calendars (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    definition TEXT NOT NULL
  );
  CREATE TABLE maps (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    max_zoom INTEGER,
    status TEXT NOT NULL DEFAULT 'processing',
    error TEXT,
    source_ext TEXT,
    scale_m_per_px REAL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX maps_ws ON maps(workspace_id);
  CREATE TABLE map_layers (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE map_items (
    id TEXT PRIMARY KEY,
    map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    layer_id TEXT REFERENCES map_layers(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('point','line','polygon')),
    title TEXT NOT NULL DEFAULT '',
    geometry TEXT NOT NULL,
    page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
    target_map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
    style TEXT NOT NULL DEFAULT '{}',
    time_mode TEXT NOT NULL DEFAULT 'static' CHECK (time_mode IN ('static','timed','journey')),
    keyframes TEXT NOT NULL DEFAULT '[]',
    journey TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX map_items_map ON map_items(map_id);
  CREATE INDEX map_items_page ON map_items(page_id);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    t_start INTEGER NOT NULL,
    t_end INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX events_ws ON events(workspace_id, t_start);
  CREATE INDEX events_page ON events(page_id);
  `,
  `
  CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('parent','spouse','sibling','other')),
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX relations_ws ON relations(workspace_id);
  CREATE INDEX relations_source ON relations(source_id);
  CREATE INDEX relations_target ON relations(target_id);
  `,
  `
  CREATE TABLE game_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    played_on TEXT NOT NULL,
    t_start INTEGER,
    t_end INTEGER,
    page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX game_sessions_ws ON game_sessions(workspace_id, played_on);
  CREATE TABLE page_activity (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    written INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (page_id, day)
  );
  CREATE INDEX page_activity_ws ON page_activity(workspace_id, day);
  INSERT INTO page_activity(page_id, workspace_id, day, written, net, created)
    SELECT id, workspace_id, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime'), word_count, word_count, 1 FROM pages;
  `,
  `
  CREATE TABLE shares (
    token TEXT PRIMARY KEY,
    page_id TEXT NOT NULL UNIQUE REFERENCES pages(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX shares_ws ON shares(workspace_id);
  `,
  `
  CREATE TABLE todos (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    todo_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    message TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT '',
    pos INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    done_at INTEGER,
    PRIMARY KEY (page_id, todo_id)
  );
  CREATE INDEX todos_ws ON todos(workspace_id, done);
  `,
  `
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX templates_slug ON templates(workspace_id, slug);
  `,
  `
  CREATE TABLE page_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'file-text',
    tag TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX page_types_ws ON page_types(workspace_id);
  `,
  `
  CREATE TABLE stat_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX stat_templates_ws ON stat_templates(workspace_id);
  `,
]

export const SCHEMA_VERSION = migrations.length

export function schemaVersionOf(d: Database.Database): number {
  try {
    const row = d.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined
    return row ? Number(row.value) : 0
  } catch { return 0 }
}

/** Brings any database (the live one, or a backup copy being restored) up to the current schema. */
export function migrate(target: Database.Database = db) {
  target.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
  let version = schemaVersionOf(target)
  while (version < migrations.length) {
    target.transaction(() => {
      target.exec(migrations[version])
      version++
      target.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version))
    })()
  }
}

export const now = () => Date.now()

