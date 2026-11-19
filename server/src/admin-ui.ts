/** The admin dashboard page. Plain HTML, CSS and JavaScript served from memory: no build step and nothing from outside. */

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Chronicle admin</title>
<link rel="stylesheet" href="/admin.css">
</head>
<body>
<div id="app"></div>
<script src="/admin.js"></script>
</body>
</html>
`

const css = String.raw`
:root { --bg: #f6f4ef; --panel: #ffffff; --text: #26231f; --muted: #6f6a60; --border: #ddd8cc; --accent: #7a4b1f; --accent-text: #ffffff; --danger: #a52a2a; --ok: #2f6b3a; --chip: #efe9da; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #17150f; --panel: #211e16; --text: #ece7da; --muted: #a39d8d; --border: #3a352a; --accent: #d9a05b; --accent-text: #1d1507; --danger: #e07a7a; --ok: #86c791; --chip: #2e2a1f; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
h1, h2, h3 { margin: 0; font-weight: 600; }
h1 { font-size: 20px; }
h2 { font-size: 17px; }
h3 { font-size: 14px; color: var(--muted); font-weight: 600; margin: 18px 0 6px; }
button, input, select { font: inherit; color: inherit; }
.top { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.top .grow { flex: 1; }
.tabs { display: flex; gap: 4px; padding: 10px 20px 0; flex-wrap: wrap; }
.tab { border: 1px solid var(--border); border-bottom: none; background: transparent; padding: 7px 14px; border-radius: 8px 8px 0 0; cursor: pointer; color: var(--muted); }
.tab[aria-selected="true"] { background: var(--panel); color: var(--text); font-weight: 600; }
main { max-width: 1000px; margin: 0 auto; padding: 0 20px 40px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 0 8px 8px 8px; padding: 18px; }
.card { border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 14px; background: var(--panel); }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.btn { border: 1px solid var(--border); background: var(--panel); padding: 6px 12px; border-radius: 6px; cursor: pointer; }
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.btn.danger { color: var(--danger); }
.btn.sm { padding: 3px 9px; font-size: 13px; }
input, select { border: 1px solid var(--border); background: var(--bg); border-radius: 6px; padding: 6px 9px; min-width: 0; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 13px; color: var(--muted); font-weight: 600; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 1px 9px; font-size: 13px; margin: 2px 4px 2px 0; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); margin-right: 6px; }
.error { color: var(--danger); margin: 8px 0 0; }
.login { max-width: 340px; margin: 12vh auto; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 24px; }
.login label { display: block; margin: 12px 0 4px; font-size: 13px; color: var(--muted); }
.login input { width: 100%; }
.login .btn { width: 100%; margin-top: 16px; }
dialog { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); color: var(--text); padding: 20px; max-width: 420px; width: calc(100% - 32px); }
dialog::backdrop { background: rgba(0, 0, 0, .45); }
dialog label { display: block; margin: 10px 0 4px; font-size: 13px; color: var(--muted); }
dialog input, dialog select { width: 100%; }
dialog .row { justify-content: flex-end; margin-top: 16px; }
@media (max-width: 640px) { th:nth-child(3), td:nth-child(3) { display: none; } }
`

const js = String.raw`
(function () {
  var app = document.getElementById('app')
  var state = { tab: 'worlds', data: null, me: null, error: '' }

  function h(tag, attrs) {
    var el = document.createElement(tag)
    attrs = attrs || {}
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]
      if (v == null || v === false) return
      if (k === 'class') el.className = v
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
      else if (k === 'value') el.value = v
      else el.setAttribute(k, v === true ? '' : v)
    })
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i])
    return el
  }
  function add(el, c) {
    if (c == null || c === false) return
    if (Array.isArray(c)) return c.forEach(function (x) { add(el, x) })
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }

  function call(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (data) {
        if (!r.ok) { var e = new Error((data && data.error) || r.statusText); e.status = r.status; throw e }
        return data
      })
    })
  }

  function ask(title, fields, okLabel, intro) {
    return new Promise(function (resolve) {
      var inputs = fields.map(function (f) {
        var input = f.options
          ? h('select', { id: 'f-' + f.name }, f.options.map(function (o) { return h('option', { value: o[0] }, o[1]) }))
          : h('input', { id: 'f-' + f.name, type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: 'off' })
        if (f.value != null) input.value = f.value
        return { f: f, input: input }
      })
      var dlg = h('dialog', {},
        h('h2', {}, title),
        intro ? h('p', { class: 'muted small' }, intro) : null,
        inputs.map(function (x) { return [h('label', { for: 'f-' + x.f.name }, x.f.label), x.input] }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { dlg.close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'button', onclick: function () {
            var out = {}
            inputs.forEach(function (x) { out[x.f.name] = x.input.value })
            dlg.dataset.done = '1'
            dlg.close()
            resolve(out)
          } }, okLabel || 'Save')))
      dlg.addEventListener('close', function () { if (!dlg.dataset.done) resolve(null); dlg.remove() })
      dlg.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') dlg.querySelector('.primary').click() })
      document.body.appendChild(dlg)
      dlg.showModal()
      if (inputs[0]) inputs[0].input.focus()
    })
  }
  function confirmDanger(text, okLabel) {
    return new Promise(function (resolve) {
      var dlg = h('dialog', {},
        h('p', {}, text),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { dlg.close() } }, 'Cancel'),
          h('button', { class: 'btn danger', type: 'button', onclick: function () { dlg.dataset.done = '1'; dlg.close(); resolve(true) } }, okLabel)))
      dlg.addEventListener('close', function () { if (!dlg.dataset.done) resolve(false); dlg.remove() })
      document.body.appendChild(dlg)
      dlg.showModal()
    })
  }

  function load() {
    return call('GET', '/api/overview').then(function (d) { state.data = d; state.error = ''; render() }).catch(fail)
  }
  function fail(e) {
    if (e.status === 401) { state.me = null; state.data = null; return render() }
    state.error = e.message
    render()
  }
  function act(promise) { return promise.then(load).catch(fail) }

  var ROLES = [['viewer', 'Viewer'], ['editor', 'Editor'], ['owner', 'Owner']]
  var roleLabel = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }

  function userName(id) {
    var u = state.data.users.filter(function (x) { return x.id === id })[0]
    return u ? u.username : 'Unknown'
  }

  function worldsTab() {
    var d = state.data
    return h('div', {},
      d.worlds.length ? null : h('p', { class: 'muted' }, 'There are no worlds yet. Create the first one below.'),
      d.worlds.map(worldCard),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: function () {
          ask('New world', [{ name: 'name', label: 'World name', placeholder: 'The Shattered Coast' }], 'Create').then(function (v) {
            if (v && v.name.trim()) act(call('POST', '/api/worlds', { name: v.name }))
          })
        } }, 'New world')))
  }

  function worldCard(w) {
    var d = state.data
    var memberIds = w.members.map(function (m) { return m.userId })
    var others = d.users.filter(function (u) { return u.role !== 'owner' && memberIds.indexOf(u.id) < 0 })
    var owners = d.users.filter(function (u) { return u.role === 'owner' })
    var picker = h('select', { 'aria-label': 'Person to add to ' + w.name }, others.map(function (u) { return h('option', { value: u.id }, u.username) }))
    var rolePick = h('select', { 'aria-label': 'Access' }, [h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'viewer' }, 'Viewer')])
    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('h2', { class: 'grow' }, w.name),
        h('span', { class: 'muted small' }, w.pages + (w.pages === 1 ? ' page' : ' pages')),
        h('button', { class: 'btn sm', onclick: function () {
          ask('Rename world', [{ name: 'name', label: 'World name', value: w.name }], 'Rename').then(function (v) {
            if (v && v.name.trim()) act(call('PATCH', '/api/worlds/' + w.id, { name: v.name }))
          })
        } }, 'Rename'),
        h('button', { class: 'btn sm danger', onclick: function () {
          confirmDanger('Delete the world "' + w.name + '"? Nobody can open it afterwards. Its pages stay in the database until someone with file access removes them.', 'Delete world').then(function (ok) {
            if (ok) act(call('DELETE', '/api/worlds/' + w.id))
          })
        } }, 'Delete')),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Access'), h('th', {}, ''))),
        h('tbody', {},
          owners.map(function (u) {
            return h('tr', {}, h('td', {}, u.username), h('td', { class: 'muted' }, 'Owner, opens every world'), h('td', {}))
          }),
          w.members.map(function (m) {
            var u = d.users.filter(function (x) { return x.id === m.userId })[0]
            if (!u || u.role === 'owner') return null
            var sel = h('select', { 'aria-label': 'Access for ' + u.username, onchange: function () {
              act(call('PUT', '/api/worlds/' + w.id + '/members/' + u.id, { role: sel.value }))
            } }, [h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'viewer' }, 'Viewer')])
            sel.value = m.role
            return h('tr', {}, h('td', {}, u.username),
              h('td', {}, u.role === 'viewer' ? h('span', { class: 'muted' }, 'Viewer (account is read-only)') : sel),
              h('td', { style: 'text-align:right' }, h('button', { class: 'btn sm', onclick: function () {
                act(call('DELETE', '/api/worlds/' + w.id + '/members/' + u.id))
              } }, 'Remove')))
          }))),
      others.length ? h('div', { class: 'row', style: 'margin-top:10px' }, picker, rolePick,
        h('button', { class: 'btn sm primary', onclick: function () {
          act(call('PUT', '/api/worlds/' + w.id + '/members/' + picker.value, { role: rolePick.value }))
        } }, 'Add to world')) : h('p', { class: 'muted small', style: 'margin:10px 0 0' }, 'Everyone with an account can already open this world.'))
  }

  function peopleTab() {
    var d = state.data
    return h('div', {},
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Account type'), h('th', {}, 'Worlds'), h('th', {}, ''))),
        h('tbody', {}, d.users.map(function (u) {
          var sel = h('select', { 'aria-label': 'Account type for ' + u.username, onchange: function () {
            act(call('PATCH', '/api/users/' + u.id, { role: sel.value }))
          } }, ROLES.map(function (r) { return h('option', { value: r[0] }, r[1]) }))
          sel.value = u.role
          var worlds = u.role === 'owner'
            ? [h('span', { class: 'muted small' }, 'All worlds')]
            : u.worlds.map(function (m) {
                var w = d.worlds.filter(function (x) { return x.id === m.id })[0]
                return w ? h('span', { class: 'chip', title: roleLabel[m.role] }, w.name) : null
              })
          if (u.role !== 'owner' && !u.worlds.length) worlds = [h('span', { class: 'muted small' }, 'None yet')]
          return h('tr', {},
            h('td', {}, u.username),
            h('td', {}, sel),
            h('td', {}, worlds),
            h('td', { style: 'text-align:right;white-space:nowrap' },
              h('button', { class: 'btn sm', onclick: function () {
                ask('New password for ' + u.username, [{ name: 'password', label: 'Password, 8 or more characters', type: 'password' }], 'Set password', 'They are signed out everywhere.').then(function (v) {
                  if (v && v.password) act(call('POST', '/api/users/' + u.id + '/password', { password: v.password }))
                })
              } }, 'Set password'), ' ',
              h('button', { class: 'btn sm', onclick: function () { act(call('POST', '/api/users/' + u.id + '/signout')) } }, 'Sign out'), ' ',
              h('button', { class: 'btn sm danger', onclick: function () {
                confirmDanger('Remove ' + u.username + '? They can no longer sign in. Pages they wrote stay.', 'Remove').then(function (ok) {
                  if (ok) act(call('DELETE', '/api/users/' + u.id))
                })
              } }, 'Remove')))
        }))),
      h('h3', {}, 'Add a person'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: function () {
          ask('Add a person', [
            { name: 'username', label: 'Name', placeholder: 'ravenna' },
            { name: 'password', label: 'Password, 8 or more characters', type: 'password' },
            { name: 'role', label: 'Account type', options: [['editor', 'Editor, can write'], ['viewer', 'Viewer, read only'], ['owner', 'Owner, opens every world and manages backups']], value: 'editor' },
          ], 'Add person', 'They can open no world until you add them to one.').then(function (v) {
            if (v && v.username.trim() && v.password) act(call('POST', '/api/users', v))
          })
        } }, 'Add person')),
      h('p', { class: 'muted small' }, 'Owners open every world. Editors and viewers open only the worlds you add them to.'))
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return 'just now'
    if (s < 3600) return Math.round(s / 60) + ' min ago'
    return Math.round(s / 3600) + ' h ago'
  }

  function onlineTab() {
    var o = state.data.online
    if (!o.length) return h('p', { class: 'muted' }, 'Nobody is signed in to a notebook right now.')
    return h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'In world'), h('th', {}, 'Editing'), h('th', {}, 'Connected'))),
      h('tbody', {}, o.map(function (p) {
        return h('tr', {},
          h('td', {}, h('span', { class: 'dot' }), p.username),
          h('td', {}, p.worlds.join(', ') || 'None'),
          h('td', {}, p.editing.map(function (e) { return h('span', { class: 'chip' }, (e.title || 'Untitled') + (e.canWrite ? '' : ' (reading)')) })),
          h('td', { class: 'muted' }, ago(p.since)))
      })))
  }

  function passwordDialog() {
    ask('Change admin password', [
      { name: 'current', label: 'Current password', type: 'password' },
      { name: 'next', label: 'New password, 8 or more characters', type: 'password' },
    ], 'Change password').then(function (v) {
      if (v) call('POST', '/api/password', v).then(function () { state.error = '' ; render() }).catch(fail)
    })
  }

  function render() {
    app.textContent = ''
    if (!state.me) return app.appendChild(loginView())
    var d = state.data
    app.appendChild(h('div', { class: 'top' },
      h('h1', { class: 'grow' }, 'Chronicle admin'),
      h('span', { class: 'muted small' }, 'Signed in as ' + state.me.username),
      h('button', { class: 'btn sm', onclick: passwordDialog }, 'Change password'),
      h('button', { class: 'btn sm', onclick: function () { call('POST', '/api/logout', {}).then(function () { state.me = null; state.data = null; render() }) } }, 'Sign out')))
    var tabs = [['worlds', 'Worlds'], ['people', 'People'], ['online', 'Online' + (d ? ' (' + d.online.length + ')' : '')]]
    app.appendChild(h('main', {},
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { class: 'tab', role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false', onclick: function () { state.tab = t[0]; render() } }, t[1])
      })),
      h('div', { class: 'panel' },
        state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
        !d ? h('p', { class: 'muted' }, 'Loading') : state.tab === 'worlds' ? worldsTab() : state.tab === 'people' ? peopleTab() : onlineTab())))
  }

  function loginView() {
    var u = h('input', { id: 'u', autocomplete: 'username', autofocus: true })
    var p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password' })
    var err = h('p', { class: 'error', role: 'alert' })
    var form = h('form', { class: 'login', onsubmit: function (e) {
      e.preventDefault()
      call('POST', '/api/login', { username: u.value, password: p.value }).then(function (me) {
        state.me = me
        load()
      }).catch(function (x) { err.textContent = x.message })
    } },
      h('h1', {}, 'Chronicle admin'),
      h('p', { class: 'muted small' }, 'Sign in with the admin account. It is separate from the accounts people use in the notebook.'),
      h('label', { for: 'u' }, 'Name'), u,
      h('label', { for: 'p' }, 'Password'), p,
      err,
      h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'))
    return form
  }

  call('GET', '/api/me').then(function (me) { state.me = me; return load() }).catch(function () { render() })
  setInterval(function () { if (state.me && state.tab === 'online' && !document.querySelector('dialog[open]')) load() }, 5000)
})()
`

export const adminUi = { html, css, js }
