import { expect, test } from '../fixtures'

test('the app loads and shows the sidebar', { tag: '@feature:shell.home' }, async ({ app }) => {
  await expect(app.getByRole('button', { name: 'Graph' })).toBeVisible()
})
