import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { COVERAGE_THRESHOLD, E2E_DIR, REPORT_DIR } from '../lib/env'
import { renderDashboard, type DashboardData, type FeatureRow, type FileRow } from './dashboard'

type CatalogFeature = { id: string; name: string; files?: string[]; status?: 'planned'; note?: string }
type CatalogArea = { id: string; name: string; features: CatalogFeature[] }

type Run = { title: string; project: string; file: string; status: string; ms: number }

const FEATURE_TAG = /^@feature:(.+)$/

export default class FeaturesReporter implements Reporter {
  private runs = new Map<string, Run[]>()
  private untagged: string[] = []
  private total = 0

  printsToStdio() { return false }

  onTestEnd(test: TestCase, result: TestResult) {
    // With retries only the last attempt counts
    if (result.status !== 'passed' && result.status !== 'skipped' && result.retry < test.retries) return
    const ids = test.tags.map((t) => FEATURE_TAG.exec(t)?.[1]).filter((x): x is string => !!x)
    const outcome = test.outcome()
    const status = outcome === 'flaky' ? 'flaky' : result.status === 'skipped' ? 'skipped' : result.status === 'passed' ? 'passed' : 'failed'
    const run: Run = { title: test.title, project: test.parent.project()?.name ?? '', file: path.basename(test.location.file), status, ms: result.duration }
    this.total++
    if (!ids.length) this.untagged.push(`${run.file}: ${test.title}`)
    for (const id of ids) {
      const list = this.runs.get(id) ?? []
      list.push(run)
      this.runs.set(id, list)
    }
  }

  async onEnd(result: FullResult) {
    const catalog = (parse(fs.readFileSync(path.join(E2E_DIR, 'features.yml'), 'utf8')) as { areas: CatalogArea[] }).areas
    const covFile = path.join(REPORT_DIR, 'coverage-data.json')
    const cov = fs.existsSync(covFile) ? JSON.parse(fs.readFileSync(covFile, 'utf8')) : null
    const files: FileRow[] = (cov?.files ?? []).map((f: any) => ({
      path: f.path,
      lines: f.summary.lines.pct,
      uncovered: f.summary.lines.uncovered,
      total: f.summary.lines.total,
      functions: f.summary.functions.pct,
    }))
    const byPath = new Map(files.map((f) => [f.path, f]))

    const known = new Set<string>()
    const features: FeatureRow[] = []
    for (const area of catalog) {
      for (const f of area.features) {
        known.add(f.id)
        const runs = (this.runs.get(f.id) ?? []).filter((r) => r.status !== 'skipped')
        const status = runs.some((r) => r.status === 'failed') ? 'failed'
          : runs.some((r) => r.status === 'flaky') ? 'flaky'
          : runs.some((r) => r.status === 'passed') ? 'passed'
          : f.status === 'planned' ? 'planned' : 'untested'
        const hits = (f.files ?? []).map((p) => byPath.get(p)).filter((x): x is FileRow => !!x)
        const tot = hits.reduce((n, h) => n + h.total, 0)
        const covered = hits.reduce((n, h) => n + (h.total - h.uncovered), 0)
        features.push({
          id: f.id, area: area.name, name: f.name, status, note: f.note ?? '',
          tests: runs, files: f.files ?? [], coverage: tot ? Math.round((covered / tot) * 1000) / 10 : null,
        })
      }
    }
    const unlisted = [...this.runs.keys()].filter((id) => !known.has(id)).sort()

    const t = cov?.summary
    const pct = (k: string) => (t ? t[k].pct : 0)
    const gate = { lines: pct('lines'), statements: pct('statements'), functions: pct('functions'), branches: pct('branches'), threshold: COVERAGE_THRESHOLD }
    // Lines and statements are gated. Functions and branches are shown on the dashboard but do not fail a run.
    const gatePassed = !!t && gate.lines >= COVERAGE_THRESHOLD && gate.statements >= COVERAGE_THRESHOLD

    const data: DashboardData = {
      generated: new Date().toISOString(),
      features, files, unlisted, untagged: this.untagged, gate, gatePassed, testCount: this.total,
    }
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.writeFileSync(path.join(REPORT_DIR, 'features.json'), JSON.stringify(data, null, 2))
    fs.writeFileSync(path.join(REPORT_DIR, 'features.html'), renderDashboard(data))

    const count = (s: string) => features.filter((f) => f.status === s).length
    console.log(`\nFeature map: ${count('passed')} tested, ${count('failed') + count('flaky')} failing or flaky, ${count('untested')} not tested yet, ${count('planned')} planned (of ${features.length})`)
    if (unlisted.length) console.log(`Tests use feature ids that are missing from features.yml: ${unlisted.join(', ')}`)
    if (this.untagged.length) console.log(`${this.untagged.length} test(s) have no @feature tag and appear on no feature`)
    console.log(`Coverage: lines ${gate.lines}%, statements ${gate.statements}%, functions ${gate.functions}%, branches ${gate.branches}% (gate ${COVERAGE_THRESHOLD}%)`)
    console.log(`Dashboard: ${path.join(REPORT_DIR, 'features.html')}`)
    // A filtered or partial run cannot reach the gate, so only a full run is held to it
    if (result.status === 'passed' && !gatePassed && !process.env.E2E_NO_GATE) {
      console.log(`Coverage is below the ${COVERAGE_THRESHOLD}% gate. Set E2E_NO_GATE=1 for a partial run.`)
      return { status: 'failed' as const }
    }
  }
}
