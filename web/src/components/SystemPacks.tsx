import { useEffect, useState } from 'react'
import { api } from '../api'
import { alertDialog, confirmDialog } from '../lib/dialog'
import { invalidatePack } from '../lib/pack'
import { BUILTIN, packText, type PackData } from '../lib/systems'
import { useStore } from '../store'
import { Select } from './Select'

// System packs of a world: a file that changes what the table shows (ability names, conditions, damage types, initiative, grid) and can bring
// roll tables, decks and macros. Installed by the owner account; the world can play by one of them.

type Installed = Awaited<ReturnType<typeof api.listPacks>>[number]

function download(name: string, pack: PackData) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([packText(pack)], { type: 'application/json' }))
  a.download = `${name}.chronicle-system.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

function pickJson(): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.json,application/json'
    el.onchange = () => resolve(el.files?.[0] ?? null)
    el.oncancel = () => resolve(null)
    el.click()
  })
}

export function SystemPacks({ id, owner, active }: { id: string; owner: boolean; active?: string }) {
  const [list, setList] = useState<Installed[]>([])
  const load = () => api.listPacks(id).then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [id, active])

  const install = async () => {
    const f = await pickJson()
    if (!f) return
    let pack: any
    try { pack = JSON.parse(await f.text()) } catch { await alertDialog('That file could not be read. A system pack is a JSON file.'); return }
    const c = pack?.content ?? {}
    const n = (c.rollTables?.length ?? 0) + (c.decks?.length ?? 0) + (c.macros?.length ?? 0)
    if (!(await confirmDialog(`${pack?.name ?? 'This pack'}${pack?.author ? ` by ${pack.author}` : ''} changes what the table shows in this world. You can switch it on afterwards.`, { title: 'Install this system pack', okLabel: 'Install' }))) return
    const importContent = n > 0 && await confirmDialog(`It also comes with ${c.rollTables?.length ?? 0} roll tables, ${c.decks?.length ?? 0} decks and ${c.macros?.length ?? 0} macros. Add them to this world too?`, { title: 'Add its content', okLabel: 'Add them too' })
    const have = list.some((p) => p.id === pack?.id)
    try {
      const r = await api.installPack(id, { pack, importContent, replace: have && await confirmDialog(`A pack called “${pack.id}” is already installed. Replace it?`, { title: 'Replace the pack', okLabel: 'Replace' }) })
      invalidatePack(); await load()
      await alertDialog(`${r.name} is installed.${importContent ? ` Added ${r.imported.rollTables} tables, ${r.imported.decks} decks and ${r.imported.macros} macros.` : ''}`)
    } catch (e: any) { await alertDialog(e.message) }
  }
  const use = (p: Installed) => useStore.getState().setWorldSettings(id, { pack: p.id }).then(() => { invalidatePack(); return load() }).catch((e) => alertDialog(e.message))
  const remove = async (p: Installed) => {
    if (!(await confirmDialog(`Remove the pack “${p.name}” from this world? Roll tables, decks and macros it brought stay.`, { title: 'Remove the pack', okLabel: 'Remove', danger: true }))) return
    await api.removePack(id, p.id).catch((e) => alertDialog(e.message))
    invalidatePack(); await load()
    // removing the pack in use also takes it out of the world's settings
    useStore.setState({ workspaces: await api.workspaces() })
  }

  return (
    <div className="packs" style={{ marginTop: 18 }}>
      <b>System packs</b>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>A pack renames the abilities, replaces the lists of conditions and damage types, sets how initiative is rolled and the grid of new scenes, and can bring roll tables, decks and macros. It builds on one of the rules above, which still decide how fights are rated and rolls are read.</p>
      <ul className="invites-list" aria-label="Installed packs">
        {list.map((p) => (
          <li key={p.id}>
            <span className="grow"><b>{p.name}</b>{p.version ? ` ${p.version}` : ''}{p.author ? ` by ${p.author}` : ''} · builds on {p.base}{p.content.rollTables + p.content.decks + p.content.macros > 0 ? ` · ${p.content.rollTables} tables, ${p.content.decks} decks, ${p.content.macros} macros` : ''} {p.active ? <b>· in use</b> : null}</span>
            {owner && !p.active && <button className="btn sm" aria-label={`Use ${p.name}`} onClick={() => void use(p)}>Use</button>}
            <button className="btn sm" aria-label={`Export ${p.name}`} onClick={() => download(p.id, p.pack)}>Export</button>
            {owner && <button className="btn sm danger" aria-label={`Remove ${p.name}`} onClick={() => void remove(p)}>Remove</button>}
          </li>
        ))}
        {!list.length && <li className="muted">No packs installed.</li>}
      </ul>
      <div className="invites-new" style={{ alignItems: 'end' }}>
        {owner && <button className="btn" onClick={install}>Install a pack from a file</button>}
        <label className="field"><span>Start your own from a built-in system</span>
          <Select className="input" value="" title="Export a built-in system" onChange={(v) => { if (v) download(BUILTIN[v as keyof typeof BUILTIN].id, BUILTIN[v as keyof typeof BUILTIN]) }}>
            <option value="">Export a built-in system…</option>
            <option value="5e">D&amp;D 5e, 2014 rules</option>
            <option value="5e-2024">D&amp;D 5e, 2024 rules</option>
            <option value="pf2e">Pathfinder 2e</option>
          </Select>
        </label>
      </div>
    </div>
  )
}
