# Testing

Chronicle has two kinds of tests. The older plain Node scripts in `scripts/` check the server API and pure logic (see AGENTS.md section 2). The end-to-end suite in `e2e/` drives the real web app in a browser and shows what is covered on a dashboard.

## Run the end-to-end suite

One time:

```powershell
npm install
npm run e2e:install
```

Then:

```powershell
npm run test:e2e
npm run test:e2e:report
```

The first command builds the server and a test build of the web app, starts a throwaway server in a temporary data directory (never your real data), runs every test in Chromium (a desktop and a phone project), and deletes everything afterwards. The second opens the dashboard.

Handy variations, from the `e2e` folder:

```powershell
$env:E2E_SKIP_BUILD='1'; npx playwright test tests/editor.spec.ts   # reuse the last web build
npx playwright test -g "slash"                                       # tests whose name matches
npm run test:ui                                                      # Playwright's interactive runner
$env:E2E_NO_GATE='1'; npx playwright test tests/maps                 # partial runs cannot reach the coverage gate
```

Ports are 3232 (app), 3233 (admin dashboard) and 3234 (fake Open5e). Set `E2E_PORT` to move them.

## The dashboard

`e2e/report/features.html` is the page to look at. It shows:

- **Features**: every line of `e2e/features.yml`, marked *Tested*, *Failing*, *Not tested yet* or *Planned*, with the tests that cover it and how much of its source files ran. Search and filter at the top.
- **Possibly missed**: the files with the most code that no test ran.
- Tests that use an id missing from the catalog, and tests with no tag.
- Links to the line by line coverage (`coverage/index.html`) and the full test report with traces and screenshots (`tests/index.html`).

### Adding something that was missed

Add a line under an area in `e2e/features.yml`:

```yaml
- id: maps.journeys
  name: "Journeys on a line"
  files: [web/src/components/MapView.tsx]
  status: planned
```

It appears as a gap straight away. `status: planned` marks it as a known gap. Once a test carries the same id it turns into *Tested*:

```ts
test('a journey follows its line', { tag: '@feature:maps.journeys' }, async ({ app }) => { ... })
```

## How the suite works

- **Playwright Test** is the runner. Each test file gets fresh worlds made through the API, so files run in parallel without touching each other.
- Fixtures in `e2e/fixtures/index.ts`: `app` (the owner's page, already inside a new world), `world`, `api` (owner API client), `makePage`, and `as('editor' | 'viewer' | 'anonymous', worldId)` for a second person. `grantAccess(worldId, role)` gives an account a world.
- Page helpers (open a view, answer the app's own prompts, run a slash command) are in `e2e/lib/ui.ts`.
- The library tests download from a small fake Open5e server (`e2e/fake-open5e.mjs`), reached through the `OPEN5E_API` setting, so they need no internet.
- Coverage comes from Chromium's V8 coverage of every page in every test, mapped back to `web/src` through source maps and merged by `monocart-reporter`. The production build is not changed; the tests use their own unminified build in `e2e/.run/web-dist`.
- The run fails when a test fails, or when **lines or statements** of `web/src` fall below 70 percent (`E2E_COVERAGE_THRESHOLD`). Functions and branches are shown but not gated. A filtered run cannot reach the gate; use `E2E_NO_GATE=1` for those.

## Writing a test

- Prefer roles, labels and titles (`getByRole`, `getByLabel`, `getByTitle`). They double as an accessibility check.
- Create data through the API and exercise the feature through the UI.
- A new page starts with a todo, so slash commands and typing go through `focusEnd` or `slash` in `lib/ui.ts`, which start a fresh line first.
- Logging out ends the server session, which every test shares. A test that logs out must use its own account (see the logout test).
- Do not wait with fixed sleeps. Wait for something to show, or poll the API with `expect.poll`.

## Known gaps

The catalog lists what is not covered yet as *Planned*, with the reason. The main ones: restoring a backup and the first run with no world (both need a server of their own), the rate limit (shared with every test), and parts of the map time bar, the relation diagram and the library field editor.
