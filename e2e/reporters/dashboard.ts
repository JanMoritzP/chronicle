export type TestRun = { title: string; project: string; file: string; status: string; ms: number }
export type FeatureRow = { id: string; area: string; name: string; status: string; note: string; tests: TestRun[]; files: string[]; coverage: number | null }
export type FileRow = { path: string; lines: number; uncovered: number; total: number; functions: number }
export type DashboardData = {
  generated: string
  features: FeatureRow[]
  files: FileRow[]
  unlisted: string[]
  untagged: string[]
  gate: { lines: number; statements: number; functions: number; branches: number; threshold: number }
  gatePassed: boolean
  testCount: number
}

const STYLE = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1b18;--muted:#6b665e;--line:#e3dfd8;--ok:#2f7d4f;--okbg:#e4f3ea;--bad:#b3261e;--badbg:#fbe6e4;--warn:#9a6700;--warnbg:#fbf0d4;--todo:#4b5fa8;--todobg:#e6eafa;--accent:#7a4e2d}
@media (prefers-color-scheme:dark){:root{--bg:#161512;--card:#201e1a;--ink:#ece8e1;--muted:#a09a8f;--line:#35322c;--ok:#6cc392;--okbg:#17301f;--bad:#ff8c82;--badbg:#3a1916;--warn:#e3b341;--warnbg:#33290f;--todo:#9fb0f0;--todobg:#1c2140;--accent:#d9a679}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:17px;margin:32px 0 10px}
.sub{color:var(--muted);margin:0 0 20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile b{display:block;font-size:26px;line-height:1.1}
.tile span{color:var(--muted);font-size:13px}
.tile.bad b{color:var(--bad)}.tile.ok b{color:var(--ok)}.tile.todo b{color:var(--todo)}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;background:var(--ok)}
.bar.low i{background:var(--bad)}.bar.mid i{background:var(--warn)}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.tools input,.tools select{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.tools input{flex:1;min-width:180px}
.chip{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:600}
.chip.passed{background:var(--okbg);color:var(--ok)}
.chip.failed{background:var(--badbg);color:var(--bad)}
.chip.flaky{background:var(--warnbg);color:var(--warn)}
.chip.untested{background:var(--badbg);color:var(--bad)}
.chip.planned{background:var(--todobg);color:var(--todo)}
details.area{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
details.area>summary{cursor:pointer;padding:12px 14px;font-weight:600;display:flex;gap:10px;align-items:center;list-style:none}
details.area>summary::-webkit-details-marker{display:none}
details.area>summary::before{content:"\\25B8";color:var(--muted)}
details.area[open]>summary::before{content:"\\25BE"}
.count{margin-left:auto;color:var(--muted);font-weight:400;font-size:13px}
.feat{border-top:1px solid var(--line);padding:10px 14px}
.feat .top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.feat .id{color:var(--muted);font:12px ui-monospace,Consolas,monospace}
.feat .cov{margin-left:auto;color:var(--muted);font-size:13px}
.feat ul{margin:6px 0 0;padding-left:20px;color:var(--muted);font-size:13px}
.feat li.failed{color:var(--bad)}
.note{color:var(--muted);font-size:13px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-top:1px solid var(--line)}
th{border-top:0;color:var(--muted);font-weight:600;font-size:13px}
td.n,th.n{text-align:right;white-space:nowrap}
.mono{font:13px ui-monospace,Consolas,monospace}
.hint{background:var(--card);border:1px dashed var(--line);border-radius:10px;padding:12px 14px;color:var(--muted);font-size:14px}
.hint code{background:var(--bg);padding:1px 5px;border-radius:4px}
a{color:var(--accent)}
`

const SCRIPT = `
(function(){
var D=JSON.parse(document.getElementById('data').textContent);
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var label={passed:'Tested',failed:'Failing',flaky:'Flaky',untested:'Not tested yet',planned:'Planned'};
var F=D.features;
function n(s){return F.filter(function(f){return f.status===s}).length}
var tested=n('passed')+n('flaky');
document.getElementById('sub').textContent='Run on '+new Date(D.generated).toLocaleString()+'. '+D.testCount+' test runs.';
function tile(v,l,cls){return '<div class="tile '+(cls||'')+'"><b>'+v+'</b><span>'+l+'</span></div>'}
function covTile(v,l){var ok=v>=D.gate.threshold;return '<div class="tile '+(ok?'ok':'bad')+'"><b>'+v+'%</b><span>'+l+' (gate '+D.gate.threshold+'%)</span><div class="bar '+(ok?'':'low')+'"><i style="width:'+Math.min(100,v)+'%"></i></div></div>'}
document.getElementById('tiles').innerHTML=
  tile(tested+' / '+F.length,'features tested',tested===F.length?'ok':'')+
  tile(n('untested'),'not tested yet',n('untested')?'bad':'ok')+
  tile(n('failed'),'failing',n('failed')?'bad':'ok')+
  tile(n('planned'),'planned','todo')+
  covTile(D.gate.lines,'lines run')+covTile(D.gate.statements,'statements run')+
  tile(D.gate.functions+'%','functions run')+tile(D.gate.branches+'%','branches run');
var order={failed:0,flaky:1,untested:2,planned:3,passed:4};
function render(){
  var q=document.getElementById('q').value.toLowerCase(),st=document.getElementById('st').value;
  var areas={},names=[];
  F.forEach(function(f){
    if(st&&f.status!==st)return;
    if(q&&(f.name+' '+f.id+' '+f.area).toLowerCase().indexOf(q)<0)return;
    if(!areas[f.area]){areas[f.area]=[];names.push(f.area)}
    areas[f.area].push(f);
  });
  var html='';
  names.forEach(function(a){
    var list=areas[a].slice().sort(function(x,y){return order[x.status]-order[y.status]});
    var bad=list.filter(function(f){return f.status==='failed'||f.status==='untested'}).length;
    var open=(bad||q||st)?' open':'';
    html+='<details class="area"'+open+'><summary>'+esc(a)+'<span class="count">'+list.filter(function(f){return f.status==='passed'||f.status==='flaky'}).length+' of '+list.length+' tested</span></summary>';
    list.forEach(function(f){
      html+='<div class="feat"><div class="top"><span class="chip '+f.status+'">'+label[f.status]+'</span><b>'+esc(f.name)+'</b><span class="id">'+esc(f.id)+'</span>'+(f.coverage!==null?'<span class="cov">'+f.coverage+'% of its files run</span>':'')+'</div>';
      if(f.note)html+='<div class="note">'+esc(f.note)+'</div>';
      if(f.tests.length){html+='<ul>';f.tests.forEach(function(t){html+='<li class="'+t.status+'">'+esc(t.title)+' <span class="mono">('+esc(t.project)+', '+esc(t.file)+')</span></li>'});html+='</ul>'}
      html+='</div>';
    });
    html+='</details>';
  });
  document.getElementById('areas').innerHTML=html||'<p class="sub">Nothing matches.</p>';
}
document.getElementById('q').addEventListener('input',render);
document.getElementById('st').addEventListener('change',render);
render();
var rows=D.files.slice().sort(function(a,b){return b.uncovered-a.uncovered}).slice(0,20);
document.querySelector('#files tbody').innerHTML=rows.map(function(f){
  var cls=f.lines<40?'low':f.lines<70?'mid':'';
  return '<tr><td class="mono">'+esc(f.path)+'</td><td class="n">'+f.lines+'%</td><td class="n">'+f.uncovered+' of '+f.total+'</td><td><div class="bar '+cls+'"><i style="width:'+f.lines+'%"></i></div></td></tr>';
}).join('');
var g='';
if(D.unlisted.length)g+='<h2>Tests with an unknown feature id</h2><div class="hint">These tags are not in features.yml, so they appear on no feature: '+D.unlisted.map(function(x){return '<code>'+esc(x)+'</code>'}).join(' ')+'</div>';
if(D.untagged.length)g+='<h2>Tests without a feature tag</h2><div class="hint">'+D.untagged.map(esc).join('<br>')+'</div>';
document.getElementById('gaps').innerHTML=g;
})();
`

export function renderDashboard(data: DashboardData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chronicle test map</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Chronicle test map</h1>
<p class="sub" id="sub"></p>
<div class="tiles" id="tiles"></div>

<h2>Features</h2>
<div class="tools">
  <input id="q" type="search" placeholder="Search features, e.g. map or slash" aria-label="Search features">
  <select id="st" aria-label="Filter by status">
    <option value="">All statuses</option><option value="untested">Not tested yet</option><option value="failed">Failing</option>
    <option value="planned">Planned</option><option value="passed">Tested</option>
  </select>
</div>
<div id="areas"></div>

<h2>Possibly missed</h2>
<p class="sub">Files with the most code that no test ran. If one of them is a feature you care about, add a line for it to <code>e2e/features.yml</code>.</p>
<table id="files"><thead><tr><th>File</th><th class="n">Lines run</th><th class="n">Not run</th><th style="width:22%"></th></tr></thead><tbody></tbody></table>

<div id="gaps"></div>

<h2>How to add something</h2>
<div class="hint">Add a line under an area in <code>e2e/features.yml</code> with an <code>id</code>, a <code>name</code> and optionally <code>files</code> (source files it lives in) and <code>status: planned</code>. It shows up here as not tested yet. A test covers it when its tag is the same id, for example <code>test('adds a pin', { tag: '@feature:maps.pins' }, ...)</code>. Open the <a href="coverage/index.html">line by line coverage</a> or the <a href="tests/index.html">full test report</a> for details.</div>
</main>
<script id="data" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}
