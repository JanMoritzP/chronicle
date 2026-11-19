import { CircleHelp } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { CHAIN_TAGS } from '../editor/chain'
import { COMMAND_LIST } from '../editor/slash'
import { ACTION_LABELS, DEFAULT_BINDINGS, loadBindings, prettyCombo, type Action } from '../lib/keys'

interface Section { id: string; title: string; text: string; body: () => ReactNode }

const K = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>
const Code = ({ children }: { children: ReactNode }) => <code className="man-code">{children}</code>

function Example({ code, result }: { code: string; result: string }) {
  return (
    <div className="man-example">
      <Code>{code}</Code>
      <span className="muted">{result}</span>
    </div>
  )
}

function Shortcuts() {
  const bindings = useMemo(() => loadBindings(), [])
  const rows = (Object.keys(ACTION_LABELS) as Action[]).map((a) => ({ a, keys: bindings[a] ?? DEFAULT_BINDINGS[a] }))
  return (
    <table className="man-table">
      <tbody>
        {rows.map(({ a, keys }) => (
          <tr key={a}>
            <td>{ACTION_LABELS[a]}</td>
            <td>{keys.map((k) => <K key={k}>{prettyCombo(k)}</K>)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const SECTIONS: Section[] = [
  {
    id: 'start', title: 'Getting started', text: 'world page folder tag sidebar tabs split',
    body: () => (
      <>
        <p>Chronicle is a notebook for your campaign. Everything lives in a <b>world</b>: pages, folders, maps, templates and the timeline. You can keep several worlds and switch between them in Settings, or with <Code>/switch</Code> in quick search (<K>Ctrl + K</K>).</p>
        <ul>
          <li>A <b>page</b> holds text. Give it a title, an icon, aliases (other names it goes by) and tags.</li>
          <li>Put pages into <b>folders</b> by dragging them in the sidebar. Tags can be nested, as in <Code>npc/villain</Code>.</li>
          <li>Open a page in a second tab, or beside the first with the split view button on the page.</li>
          <li>Every edit is kept. The clock button on a page opens its version history, and any earlier version can be restored.</li>
          <li>Deleted pages go to the trash first.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'writing', title: 'Writing and linking', text: 'wikilink link backlink mention embed heading list table image',
    body: () => (
      <>
        <p>Format text with the usual keys, such as <K>Ctrl + B</K> for bold and <K>Ctrl + I</K> for italic. Paste or drop an image into a page to add it.</p>
        <p>Type <Code>{'{{'}</Code> to link to another page. The menu finds pages by title or alias, and after a <Code>#</Code> it finds a section of that page.</p>
        <Example code="{{Mira Vale}}" result="Links to the page Mira Vale. Renaming the page never breaks the link." />
        <Example code="{{Mira Vale|the captain}}" result="Shows “the captain” and links to Mira Vale." />
        <Example code="{{Mira Vale#Secrets}}" result="Links to the Secrets section of that page." />
        <p>Hover over a link to preview the page. At the bottom of a page you find its backlinks, and names that appear in the text without a link yet.</p>
        <p>Use <b>Embed page</b> from the slash menu to show another page, or one of its sections, inside this one.</p>
      </>
    ),
  },
  {
    id: 'slash', title: 'The slash menu', text: 'slash commands menu insert block',
    body: () => (
      <>
        <p>Type <K>/</K> at the start of a line or after a space to open the menu. A bare <K>/</K> lists everything. Keep typing to narrow it: <Code>/warn</Code> finds the warning box. Use <K>↑</K> <K>↓</K> to move, <K>Enter</K> or <K>Tab</K> to insert and <K>Esc</K> to close.</p>
        <p>Your own templates and stat block forms appear in the same menu, with the templates first.</p>
        <table className="man-table">
          <tbody>
            {COMMAND_LIST.map((c) => (
              <tr key={c.id}><td><Code>/{c.id}</Code></td><td><b>{c.label}</b><div className="muted">{c.sub}</div></td></tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'chains', title: 'Chains', text: 'chain emmet abbreviation nest repeat h2 ul li',
    body: () => (
      <>
        <p>A chain builds several blocks in one go. It is typed in the slash menu, and the menu says what it will insert before you press Enter. One undo removes the whole chain.</p>
        <table className="man-table">
          <tbody>
            <tr><td><Code>a&gt;b</Code></td><td>b inside a</td></tr>
            <tr><td><Code>a+b</Code></td><td>b after a</td></tr>
            <tr><td><Code>a*3</Code></td><td>a three times</td></tr>
            <tr><td><Code>(a+b)*3</Code></td><td>the pair three times</td></tr>
            <tr><td><Code>a{'{text}'}</Code></td><td>text for a. Text may hold spaces.</td></tr>
            <tr><td><Code>$</Code></td><td>inside text: the number of the repeat. <Code>$$</Code> pads to two digits.</td></tr>
          </tbody>
        </table>
        <p><b>Text goes in braces.</b> To make a heading that says “My heading”, type <Code>/h2{'{My heading}'}</Code>. Writing <Code>/h2&gt;My heading</Code> does not work, because <Code>&gt;</Code> means “put a block called My inside”.</p>
        <Example code="/h2{Plot hooks}+ul>li*3" result="A heading and a bullet list with three items." />
        <Example code="/ul>li{Goblin $}*4" result="A list: Goblin 1, Goblin 2, Goblin 3, Goblin 4." />
        <Example code="/table3x4" result="A table with 3 rows and 4 columns, the first row a header." />
        <Example code="/cols3" result="Three columns side by side." />
        <Example code="/roll20" result="A d20 table with one row per result, ready to fill in." />
        <Example code="/secret>p{The duke knows}" result="A secret box with a line of text." />
        <p>Block names you can chain:</p>
        <table className="man-table">
          <tbody>
            {CHAIN_TAGS.map((t) => <tr key={t.name}><td><Code>{t.name}</Code></td><td>{t.label}</td></tr>)}
          </tbody>
        </table>
        <p>You can also chain the slash name of one of your templates or stat blocks. The commands that open a dialog (<Code>image</Code>, <Code>embed</Code>, <Code>pin</Code>, <Code>teven</Code>, <Code>relation</Code>) may come last: everything before them is inserted, then the dialog opens.</p>
        <p>At most 50 repeats and 300 blocks per chain.</p>
      </>
    ),
  },
  {
    id: 'boxes', title: 'Boxes, sections and columns', text: 'note warning read-aloud secret collapsible fold columns contents',
    body: () => (
      <>
        <ul>
          <li><b>Note, warning, read-aloud</b> boxes highlight a block of text. Click the label of a box to switch its kind.</li>
          <li><b>Secret</b> is for you. When you share a page, its secrets are never sent: readers see a closed box.</li>
          <li><b>Collapsible section</b> has a title and can be closed. Readers of a shared page see it closed.</li>
          <li><b>Columns</b> sit side by side, two to four of them, and stack on a narrow screen.</li>
          <li><b>Table of contents</b> links to the headings of the page and keeps itself current.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'special', title: 'Special pages and stat blocks', text: 'person monster location page type stat block fields portrait',
    body: () => (
      <>
        <p>A <b>special page</b> is a page with fixed fields next to its text, for example a Person with race, class and home, or a Monster with a stat block. Create one from the menu next to “New page”. Chronicle adds a tag to it automatically.</p>
        <p>Design your own kinds under <b>Special pages</b> in the sidebar: pick the fields, where they sit and which tag the pages get. Deleting a kind keeps its pages as plain pages.</p>
        <p>A <b>stat block</b> is a form of stats that shows up in hover previews. Insert one with <Code>/stat</Code>, or design your own form under <b>Stat block forms</b>.</p>
      </>
    ),
  },
  {
    id: 'library', title: 'Library', text: 'open5e spell monster item class condition reference srd',
    body: () => (
      <>
        <p>The library holds the Open5e reference data: creatures, spells, items, classes and more. It is shared by all worlds.</p>
        <ul>
          <li>Open <b>Library</b> in the sidebar to browse and search it.</li>
          <li>Use <b>Add from the library</b> (<K>Alt + L</K>) to make a page from an entry. The page gets the matching special page type.</li>
          <li>The button on a page that turns names of spells, conditions and abilities into links does so through the library.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'templates', title: 'Templates', text: 'template save reuse',
    body: () => (
      <>
        <p>Save a page you reuse as a template from its <b>…</b> menu, or write one under <b>Templates</b>. Then type <Code>/</Code> and its name to insert it at the cursor. Give it a short description: the slash menu shows it.</p>
        <p>The presets <Code>/npc</Code>, <Code>/place</Code> and <Code>/encounter</Code> are ready-made starting points. A template with the same name replaces a preset.</p>
      </>
    ),
  },
  {
    id: 'world', title: 'Maps, timeline and relations', text: 'map pin timeline event calendar relations family tree',
    body: () => (
      <>
        <ul>
          <li><b>Maps.</b> Upload a map image under Maps and zoom into it. Use <Code>/pin</Code> in a page to mark where that page is on a map.</li>
          <li><b>Timeline.</b> Use <Code>/teven</Code> to give a page a date. The timeline lists every event in your calendar.</li>
          <li><b>Relations.</b> Use <Code>/relation</Code> to link a page to a parent, spouse, sibling or any relationship you name. The Relations view draws the family tree.</li>
          <li><b>Sessions.</b> Keep notes per session and see statistics about your campaign.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'todos', title: 'Todos and the zettelkasten', text: 'todo marker capture zettel inbox idea',
    body: () => (
      <>
        <ul>
          <li><b>Todos.</b> Type <Code>/todo</Code> to leave a marker with a note, for something to fix or fill in later. The Todos view lists every marker in the world until you tick it off.</li>
          <li><b>Quick capture.</b> <K>Alt + C</K> opens a box for a loose idea from anywhere. It lands in the Zettelkasten. Turn it into a page when you are ready, and Chronicle links the two and marks the note as processed.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'search', title: 'Search and commands', text: 'search ctrl k quick find command palette',
    body: () => (
      <>
        <p><K>Ctrl + K</K> opens quick search. It finds pages by title, alias, section and full text, and notes in the Zettelkasten.</p>
        <ul>
          <li>Start with <Code>#</Code> to search tags.</li>
          <li>Start with <Code>/</Code> to run a command: open a view, switch world, change theme, log out.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'share', title: 'Sharing and working together', text: 'share public link viewer editor live collaborate export backup',
    body: () => (
      <>
        <ul>
          <li><b>Share a page.</b> Choose “Share publicly…” in the <b>…</b> menu of a page to get a public, read-only link. Links and embeds only reach other pages that are shared as well, and secrets stay closed.</li>
          <li><b>Work together.</b> Several people can edit the same page at the same time and see each other’s cursors. An editor can change a world, a viewer can only read it. Whoever runs the server decides who may open which world.</li>
          <li><b>Export and backup.</b> Settings can export a whole world as a zip. The server keeps daily backups.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'keys', title: 'Keyboard shortcuts', text: 'shortcuts keys keyboard bindings',
    body: () => (
      <>
        <p>You can change these in Settings.</p>
        <Shortcuts />
      </>
    ),
  },
]

export function ManualView() {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = SECTIONS.filter((s) => !needle || `${s.title} ${s.text}`.toLowerCase().includes(needle))
  const jump = (id: string) => document.getElementById(`man-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="view manual">
      <h1 style={{ marginTop: 0 }}><CircleHelp size={26} style={{ verticalAlign: -3 }} /> Manual</h1>
      <p className="muted">What Chronicle can do and how to ask for it. Type <K>/</K> in a page to see every command.</p>
      <input className="input" placeholder="Search the manual, e.g. columns" aria-label="Search the manual" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="man-toc">
        {shown.map((s) => <button key={s.id} className="chip" onClick={() => jump(s.id)}>{s.title}</button>)}
      </div>
      {!shown.length && <p className="muted">Nothing in the manual matches “{q}”.</p>}
      {shown.map((s) => (
        <section key={s.id} id={`man-${s.id}`} className="man-section">
          <h2>{s.title}</h2>
          {s.body()}
        </section>
      ))}
    </div>
  )
}
