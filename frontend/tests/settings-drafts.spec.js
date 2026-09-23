import { test, expect } from '@playwright/test'

async function mockSettings(page, options = {}) {
  let settings = { min_checking: 60000, living_budget_configured: 1, cash_cushion: 10000, large_payment_threshold: 100000, default_payment_account_id: 1, zip_code: '94110', household_size: 2, advice_posture: 'default', ...options.settings }
  let lines = structuredClone(options.lines || [])
  const writes = []
  let nextId = 100
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      if (path === options.failLoad) return route.fulfill({ status: 503, json: {} })
      const json = path === '/api/auth/me' ? { id: 1, email: 'test@example.com' }
        : path === '/api/settings' ? settings
        : path === '/api/budget/lines' ? lines
        : path === '/api/accounts' ? [{ id: 1, type: 'checking', name: 'Everyday checking', current_balance: 426840, is_active: 1 }, { id: 2, type: 'checking', name: 'Household checking', current_balance: 200000, is_active: 1 }]
        : []
      return route.fulfill({ json })
    }
    const body = request.postDataJSON()
    writes.push({ path, method: request.method(), body })
    if (path === '/api/settings') {
      if (options.failSave) return route.fulfill({ status: 500, json: { detail: 'Settings could not be saved.' } })
      settings = { ...settings, ...body, ...(body.default_payment_account_id === 0 ? { default_payment_account_id: null } : {}) }
      return route.fulfill({ json: settings })
    }
    if (path === '/api/budget/plan') {
      if (options.failSave) return route.fulfill({ status: 500, json: { detail: 'Could not save living costs. Your draft is still here; try again.' } })
      lines = body.lines.map((line) => ({ ...line, id: line.id ?? nextId++, origin: 'user' }))
      if (body.min_checking != null) settings = { ...settings, min_checking: body.min_checking, living_budget_configured: 1 }
      return route.fulfill({ json: { lines, settings: { min_checking: settings.min_checking, living_budget_configured: settings.living_budget_configured } } })
    }
    if (path === '/api/budget/estimate') return route.fulfill({ json: [
      { category: 'groceries', amount: 55555, origin: 'llm_estimate' },
      { category: 'transportation', amount: 18000, origin: 'llm_estimate' },
      { category: 'utilities', amount: 22000, origin: 'llm_estimate' },
    ] })
    throw new Error(`Unexpected mutation ${request.method()} ${path}`)
  })
  return writes
}

test('explicit section saves preserve other drafts and show only saved rules', async ({ page }) => {
  const writes = await mockSettings(page)
  await page.goto('/settings')
  await page.getByLabel('Financial priority').selectOption('balanced')
  await expect(page.getByText(/aiming to save roughly 20%/)).toBeVisible()
  await page.getByLabel('Monthly living-cost estimate').fill('900')
  await page.getByLabel('Minimum cash cushion').fill('125.5')
  await page.getByLabel('Large payment threshold').fill('0')
  await page.getByLabel('Default payment account').selectOption('2')
  await page.getByRole('heading', { name: 'Settings.', exact: true }).click()
  expect(writes).toEqual([])
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$600.00')
  await page.getByRole('button', { name: 'Save cash planning', exact: true }).click()
  await expect(page.getByText('Cash planning saved', { exact: true })).toBeVisible()
  expect(writes[0].body).toEqual({ cash_cushion: 12550, large_payment_threshold: 0, default_payment_account_id: 2 })
  await expect(page.getByLabel('Financial priority')).toHaveValue('balanced')
  await expect(page.getByLabel('Monthly living-cost estimate')).toHaveValue('900.00')
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$900.00')
  expect(writes[1]).toEqual({ path: '/api/budget/plan', method: 'PUT', body: { lines: [], base_lines: [], min_checking: 90000 } })
  await page.getByRole('button', { name: 'Save advisor priority', exact: true }).click()
  await expect(page.getByText('Advisor priority saved', { exact: true })).toBeVisible()
  expect(writes[2].body).toEqual({ advice_posture: 'balanced' })
  await page.getByLabel('Household size').fill('')
  await page.getByRole('button', { name: 'Save local estimates', exact: true }).click()
  expect(writes[3].body).toEqual({ zip_code: '94110', household_size: null })
  await expect(page.getByText('Local estimates saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Household size')).toHaveValue('')
  await expect(page.getByLabel('Large payment threshold')).toHaveValue('0.00')
  await expect(page.getByLabel('Default payment account')).toHaveValue('2')
  await expect(page.getByLabel('Financial priority')).toHaveValue('balanced')
})

test('categories are drafts until explicitly saved, with discard and fallback restoration', async ({ page }) => {
  const writes = await mockSettings(page)
  await page.goto('/settings')
  await page.getByLabel('New category', { exact: true }).fill('Groceries')
  await page.getByLabel('New monthly budget amount').fill('$450.50')
  await page.getByRole('button', { name: 'Add category', exact: true }).click()
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$450.50')
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$600.00')
  await page.getByLabel('Monthly amount for Groceries').fill('500.25')
  await page.getByRole('heading', { name: 'Living costs', exact: true }).click()
  expect(writes).toEqual([])
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$500.25')
  expect(writes[0].body.lines[0].amount).toBe(50025)
  await page.getByRole('button', { name: 'Remove Groceries' }).click()
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$600.00')
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$500.25')
  await page.getByRole('region', { name: 'Living costs', exact: true }).getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByLabel('Monthly amount for Groceries')).toHaveValue('500.25')
  expect(writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Remove Groceries' }).click()
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$600.00')
  await page.reload()
  await expect(page.getByLabel('Monthly living-cost estimate')).toHaveValue('600.00')
})

test('estimate preview protects edited categories and only applies selected suggestions on save', async ({ page }) => {
  const writes = await mockSettings(page, { lines: [{ id: 1, category: 'groceries', amount: 45000, origin: 'user' }, { id: 2, category: 'transportation', amount: 10000, origin: 'llm_estimate' }] })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Preview local estimates' }).click()
  const preview = page.getByRole('region', { name: 'Estimate preview' })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('checkbox', { name: /Groceries/ })).toBeDisabled()
  await expect(preview).toContainText('Current draft: $100.00')
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$550.00')
  expect(writes).toEqual([{ path: '/api/budget/estimate', method: 'POST', body: { zip_code: '94110', household_size: 2 } }])
  await preview.getByRole('checkbox', { name: /Utilities/ }).uncheck()
  await page.getByRole('button', { name: 'Use selected in draft' }).click()
  await expect(page.getByLabel('Monthly amount for transportation')).toHaveValue('180.00')
  await expect(page.getByLabel('Monthly amount for groceries')).toHaveValue('450.00')
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$630.00')
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$550.00')
  expect(writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$630.00')
  expect(writes[1].body.lines).toHaveLength(2)
})

test('currency formatting and invalid values never submit silently', async ({ page }) => {
  const writes = await mockSettings(page)
  await page.goto('/settings')
  const amount = page.getByLabel('Monthly living-cost estimate')
  await expect(amount.locator('..')).toContainText('$')
  await amount.fill('$1,234.50')
  await page.getByLabel('Minimum cash cushion').fill('.5')
  await page.getByRole('heading', { name: 'Cash planning', exact: true }).click()
  await expect(amount).toHaveValue('1234.50')
  await expect(page.getByLabel('Minimum cash cushion')).toHaveValue('0.50')
  await page.getByRole('button', { name: 'Save cash planning', exact: true }).click()
  await expect(page.getByText('Cash planning saved', { exact: true })).toBeVisible()
  expect(writes[0].body.cash_cushion).toBe(50)
  await amount.fill('1.234')
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(amount).toHaveAttribute('aria-invalid', 'true')
  await page.getByLabel('Minimum cash cushion').fill('-10')
  await page.getByRole('button', { name: 'Save cash planning', exact: true }).click()
  await expect(page.getByLabel('Minimum cash cushion')).toHaveAttribute('aria-invalid', 'true')
  await page.getByLabel('ZIP code').fill('abc')
  await page.getByRole('button', { name: 'Save local estimates', exact: true }).click()
  expect(writes).toHaveLength(1)
  await page.getByRole('region', { name: 'Cash planning', exact: true }).getByRole('button', { name: 'Discard', exact: true }).click()
  await page.getByLabel('Minimum cash cushion').fill('20')
  await page.getByRole('button', { name: 'Save cash planning', exact: true }).click()
  await expect(page.getByText('Cash planning saved', { exact: true })).toBeVisible()
  expect(writes[1].body.cash_cushion).toBe(2000)
})

for (const failLoad of ['/api/settings', '/api/budget/lines', '/api/accounts']) {
  test(`failed ${failLoad} loading disables all edits and retry restores saved values`, async ({ page }) => {
    const options = { failLoad }
    const writes = await mockSettings(page, options)
    await page.goto('/settings')
    await expect(page.getByRole('alert')).toContainText('Could not load')
    await expect(page.getByRole('button', { name: /^Save / })).toHaveCount(0)
    await expect(page.getByLabel('Monthly living-cost estimate')).toHaveCount(0)
    options.failLoad = null
    await page.getByRole('button', { name: 'Retry loading settings' }).click()
    await expect(page.getByLabel('Monthly living-cost estimate')).toHaveValue('600.00')
    await expect(page.getByLabel('Minimum cash cushion')).toHaveValue('100.00')
    expect(writes).toEqual([])
  })
}

test('failed section saves retain drafts and leave the saved summary intact', async ({ page }) => {
  const options = { failSave: true }
  const writes = await mockSettings(page, options)
  await page.goto('/settings')
  await page.getByLabel('Monthly living-cost estimate').fill('900')
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save living costs')
  await expect(page.getByLabel('Monthly living-cost estimate')).toHaveValue('900.00')
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$600.00')
  await page.getByLabel('Minimum cash cushion').fill('250')
  await page.getByRole('button', { name: 'Save cash planning', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Cash planning', exact: true }).getByRole('alert')).toContainText('could not be saved')
  await expect(page.getByLabel('Minimum cash cushion')).toHaveValue('250.00')
  options.failSave = false
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$900.00')
  await expect(page.getByLabel('Minimum cash cushion')).toHaveValue('250.00')
  expect(writes).toHaveLength(3)
})

test('phone layout supports preview and explicit saves without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await mockSettings(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Preview local estimates' }).click()
  await expect(page.getByRole('region', { name: 'Estimate preview' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Use selected in draft' }).click()
  await page.getByRole('button', { name: 'Save living costs', exact: true }).click()
  await expect(page.getByLabel('Saved monthly living costs')).toHaveText('$955.55')
  expect(errors).toEqual([])
})
