import { test, expect } from '@playwright/test'

async function mockShell(page, { failLogout = false } = {}) {
  const requests = []
  await page.route('**/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push({ method: request.method(), path })
    if (path === '/api/ai/chat') return route.fulfill({ contentType: 'text/event-stream', body: 'event: text\ndata: {"text":"Your recommendations."}\n\nevent: done\ndata: {}\n\n' })
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 1, email: 'a.long.account.address@example.com' } })
    if (path === '/api/auth/logout') return route.fulfill({ status: failLogout ? 500 : 200, json: {} })
    if (path === '/api/auth/login') return route.fulfill({ contentType: 'text/html', body: '<h1>Sign in</h1>' })
    if (path === '/api/history/net-worth') return route.fulfill({ json: { series: [] } })
    if (path === '/api/events') return route.fulfill({ json: { events: [], next_cursor: null } })
    throw new Error(`Unexpected request: ${path}`)
  })
  return requests
}

test('desktop rail preserves navigation, page drafts, and collapse preference', async ({ page }) => {
  await mockShell(page)
  await page.goto('/chat')
  const draft = page.getByRole('textbox', { name: 'Message your advisor' })
  await draft.fill('Help me plan for rent')
  await page.getByRole('button', { name: 'Collapse navigation' }).click()
  await expect(draft).toHaveValue('Help me plan for rent')
  await expect(page.getByRole('link', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL('/history')
  await expect(page.locator('.shell-breadcrumb')).toHaveText('Perspective/History')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Ask advisor' }).click()
  await expect(page).toHaveURL('/chat')
  await page.getByRole('button', { name: 'Expand navigation' }).click()
  await expect(page.locator('aside nav a')).toHaveText(['Dashboard', 'Accounts', 'Expenses', 'Income', 'Chat', 'History', 'Settings'])
})

test('mobile drawer traps focus, closes with Escape or backdrop, and navigates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockShell(page)
  await page.goto('/chat')
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  const drawer = page.getByRole('dialog', { name: 'Main navigation' })
  await trigger.click()
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'Settings', exact: true }).focus()
  await page.keyboard.press('Tab')
  expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.mouse.click(375, 300)
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await drawer.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL('/history')
  await expect(drawer).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('resizing an open drawer releases the page on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockShell(page)
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('textbox', { name: 'Message your advisor' }).fill('Still usable')
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('account popover dismisses and signs out using existing auth endpoints', async ({ page }) => {
  const requests = await mockShell(page)
  await page.goto('/chat')
  const trigger = page.getByRole('button', { name: 'Account options' })
  await trigger.click()
  await expect(page.getByText('a.long.account.address@example.com')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).not.toBeVisible()
  await trigger.click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL('/api/auth/login')
  expect(requests).toContainEqual({ method: 'POST', path: '/api/auth/logout' })
})

test('failed sign out is visible and can be retried', async ({ page }) => {
  await mockShell(page, { failLogout: true })
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Account options' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Could not sign out. Please try again.')
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled()
  await expect(page).toHaveURL('/chat')
})

for (const width of [320, 768, 1440]) {
  test(`app shell fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockShell(page)
    await page.goto('/history')
    await expect(page.locator('.shell-breadcrumb')).toContainText('History')
    await page.getByRole('button', { name: 'Account options' }).click()
    const popover = await page.locator('#account-popover').boundingBox()
    expect(popover.x).toBeGreaterThanOrEqual(0)
    expect(popover.x + popover.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
