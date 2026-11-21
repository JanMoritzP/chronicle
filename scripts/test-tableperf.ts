import { DEFAULT_PERF, loadPerf, statsText } from '../web/src/lib/tableperf'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++ }

check('nothing chosen means everything on and no numbers', JSON.stringify(loadPerf(null)) === JSON.stringify(DEFAULT_PERF) && !DEFAULT_PERF.fogOnDrop && !DEFAULT_PERF.light && !DEFAULT_PERF.show)
check('choices are read back', JSON.stringify(loadPerf('{"fogOnDrop":true,"light":true,"show":true}')) === '{"fogOnDrop":true,"light":true,"show":true}')
check('only true counts, and junk is ignored', !loadPerf('{"light":"yes"}').light && JSON.stringify(loadPerf('nope')) === JSON.stringify(DEFAULT_PERF))
check('the numbers read as a line', statsText({ fps: 58, fogMs: 3.24 }) === '58 fps, fog 3.2 ms')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
