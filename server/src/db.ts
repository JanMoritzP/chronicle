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
  `
  ALTER TABLE workspaces ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
  `,
  `
  ALTER TABLE links ADD COLUMN lib_key TEXT;
  CREATE INDEX links_lib ON links(lib_key);
  `,
  `
  CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX workspace_members_user ON workspace_members(user_id);
  INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
    SELECT w.id, u.id, CASE WHEN u.role = 'viewer' THEN 'viewer' ELSE 'editor' END, CAST(strftime('%s','now') AS INTEGER) * 1000
    FROM workspaces w CROSS JOIN users u WHERE u.role != 'owner';
  CREATE TABLE admins (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE page_docs (
    page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    state BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE page_versions ADD COLUMN author_id TEXT;
  ALTER TABLE page_versions ADD COLUMN author_name TEXT;
  ALTER TABLE page_versions ADD COLUMN props TEXT;
  ALTER TABLE page_versions ADD COLUMN meta TEXT;
  ALTER TABLE page_versions ADD COLUMN reason TEXT;
  ALTER TABLE page_versions ADD COLUMN restored_from INTEGER;
  `,
  `
  CREATE TABLE comments (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    comment_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    from_name TEXT NOT NULL DEFAULT '',
    to_name TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT '',
    pos INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    done_at INTEGER,
    PRIMARY KEY (page_id, comment_id)
  );
  CREATE INDEX comments_ws ON comments(workspace_id, done);
  `,
  `
  CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    bg TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 2100,
    height INTEGER NOT NULL DEFAULT 1400,
    grid TEXT NOT NULL DEFAULT 'square',
    grid_size REAL NOT NULL DEFAULT 70,
    unit TEXT NOT NULL DEFAULT 'ft',
    dist REAL NOT NULL DEFAULT 5,
    diagonal TEXT NOT NULL DEFAULT '5-10-5',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX scenes_ws ON scenes(workspace_id, sort);
  CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    size REAL NOT NULL DEFAULT 1,
    rotation REAL NOT NULL DEFAULT 0,
    image TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    page_id TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    owners TEXT NOT NULL DEFAULT '[]',
    z INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX tokens_scene ON tokens(scene_id);
  CREATE TABLE table_state (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    active_scene_id TEXT,
    settings TEXT NOT NULL DEFAULT '{}'
  );
  `,
  `
  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    to_ids TEXT NOT NULL DEFAULT '[]',
    parts TEXT NOT NULL
  );
  CREATE INDEX chat_ws ON chat_messages(workspace_id, ts);
  `,
  `
  ALTER TABLE scenes ADD COLUMN fog INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE scenes ADD COLUMN darkness REAL NOT NULL DEFAULT 0;
  CREATE TABLE scene_walls (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
    kind TEXT NOT NULL DEFAULT 'wall',
    open INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX walls_scene ON scene_walls(scene_id);
  ALTER TABLE table_state ADD COLUMN combat TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE encounters (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX encounters_ws ON encounters(workspace_id);
  CREATE TABLE drawings (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    points TEXT NOT NULL,
    color TEXT NOT NULL,
    width REAL NOT NULL DEFAULT 4,
    fill TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    gm_only INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX drawings_scene ON drawings(scene_id);
  CREATE TABLE scene_fog (
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    mask BLOB NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scene_id, user_id)
  );
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

