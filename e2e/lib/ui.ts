import { expect, type Locator, type Page } from '@playwright/test'

export const sidebar = (page: Page) => page.getByRole('complementary')
export const activeTab = (page: Page) => page.locator('.tab.active')
/** The app's own prompt, confirm and alert (other panels may also have role dialog). */
export const dialog = (page: Page) => page.locator('.dialog-overlay').getByRole('dialog')
export const editorOf = (page: Page) => page.locator('.ProseMirror').first()

/** Open a sidebar view by its name. */
export async function openView(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name, exact: true }).click()
  await expect(activeTab(page)).toContainText(name)
}

/** Open a page from the sidebar list. */
export async function openPage(page: Page, title: string) {
  await sidebar(page).getByRole('button', { name: title, exact: true }).first().click()
  await expect(page.getByLabel('Page title')).toHaveValue(title)
  // the live document must be connected before anything typed is kept
  await expect(page.locator('.save-state')).toHaveText(/Saved|Saving|Unsaved|Read-only/)
}

/** Answer the app's own text prompt (never a native dialog). */
export async function answerPrompt(page: Page, text: string) {
  const d = dialog(page)
  await d.getByRole('textbox').fill(text)
  await d.locator('button[type=submit]').click()
}

export async function confirmDialog(page: Page) {
  await dialog(page).locator('button[type=submit]').click()
}

/** Type a slash command into the editor and run the highlighted entry. */
export async function slash(page: Page, query: string, expectLabel?: string | RegExp) {
  await focusEnd(page)
  await page.keyboard.type('/' + query)
  const sel = page.locator('.suggest .result.sel')
  await expect(sel).toBeVisible()
  if (expectLabel) await expect(sel).toContainText(expectLabel)
  await page.keyboard.press('Enter')
}

/** Put the caret on a new empty line at the end. A fresh page starts with a todo, and slash commands need a line start or a space before them. */
export async function focusEnd(page: Page) {
  await editorOf(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
}

export async function typeInEditor(page: Page, text: string) {
  await focusEnd(page)
  await page.keyboard.type(text)
}

export async function menuItem(page: Page, name: string | RegExp) {
  await page.getByTitle('More actions').click()
  await page.getByRole('button', { name }).click()
}

export const saved = (page: Page): Locator => page.getByText('Saved', { exact: true })

/** Close an app alert if one shows up shortly (e.g. a confirmation after saving). */
export async function dismissAlert(page: Page) {
  const d = dialog(page)
  try { await d.waitFor({ state: 'visible', timeout: 2000 }) } catch { return }
  await d.locator('button[type=submit]').click()
}
