import { test, expect } from '@playwright/test'

const complete = {
  complete: true, issues: [], available: 102000, projected_balance: 102000, shortfall: 0,
  checking_balance: 200000, checking_label: 'Checking',
  next_payday: { date: '2026-06-20', amount: 200000, name: 'Salary' },
  account_payments: 30000, expense_payments: 50000, living_costs: 18000, cash_cushion: 0,
  bills: [{ kind: 'account', id: 2, name: 'Card payment', due: '2026-06-15', amount: 30000, overdue: false }],
}

async function mockApi(page, summary = complete, options = {}) {
  let settings = { min_checking: 60000, cash_cushion: 0, living_budget_configured: 1, ...options.settings }
  let lines = options.lines || []
  let nextId = 100
  const writes = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      const body = request.method() === 'DELETE' ? null : request.postDataJSON()
      writes.push({ path, body })
      if (path === '/api/settings') settings = { ...settings, ...body }
      if (path.startsWith('/api/budget/lines') && options.failBudgetWrites) return route.fulfill({ status: 500, json: { detail: 'Failed' } })
      if (path === '/api/budget/lines') lines = [...lines, { id: nextId++, origin: 'user', ...body }]
      if (path.startsWith('/api/budget/lines/')) {
        const id = Number(path.split('/').at(-1))
        lines = request.method() === 'DELETE' ? lines.filter((line) => line.id !== id)
          : lines.map((line) => line.id === id ? { ...line, ...body, origin: 'user' } : line)
      }
      if (path === '/api/budget/estimate') lines = [{ id: 1, category: 'groceries', amount: 55555, origin: 'llm_estimate' }]
      return route.fulfill({ json: { id: 1, ...body } })
    }
    const data = path === '/api/auth/me' ? { id: 1, email: 'test@example.com' }
      : path === '/api/dashboard/safe-to-spend' ? summary
      : path === '/api/settings' ? settings
      : path === '/api/budget/lines' ? lines
      : path === '/api/accounts' ? options.accounts || []
      : path === '/api/history/net-worth' ? { series: [] }
      : path === '/api/budget/spending-money' ? { has_budget: true, spending_money: 290000, monthly_cash_flow: 350000, monthly_debt_payments: 30000, budget_total: 60000, issues: [] }
      : []
    await route.fulfill({ json: data })
  })
  return writes
}

for (const [state, summary] of [
  ['complete', complete],
  ['shortfall', { ...complete, available: 0, projected_balance: -18000, shortfall: 18000 }],
  ['incomplete', { ...complete, complete: false, available: null, projected_balance: null, issues: ['Set an income schedule so the next paycheck can be determined.'] }],
]) {
  test(`dashboard shows ${state} cash plan and its breakdown`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await mockApi(page, summary)
    await page.goto('/')
    await expect(page.getByText('Projected monthly surplus', { exact: true })).toBeVisible()
    if (state === 'complete') await expect(page.getByText('$1,020.00', { exact: true }).first()).toBeVisible()
    if (state === 'shortfall') await expect(page.getByText('$180.00 short before Jun 20, 2026')).toBeVisible()
    if (state === 'incomplete') await expect(page.getByText('Estimate incomplete — see details below')).toBeVisible()
    await page.locator('summary').click()
    await expect(page.getByText('− Living costs until payday', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit living costs and cushion' })).toBeVisible()
    if (state === 'incomplete') await expect(page.getByText(summary.issues[0], { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('settings saves living costs, cushion, and the large payment threshold', async ({ page }) => {
  const writes = await mockApi(page)
  await page.goto('/settings')
  await page.getByLabel('Monthly living-cost estimate').fill('900')
  await page.getByLabel('Minimum cash cushion').fill('100')
  await page.getByLabel('Large payment threshold').fill('1000')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible()
  expect(writes.find((w) => w.path === '/api/settings').body).toMatchObject({ min_checking: 90000, cash_cushion: 10000, large_payment_threshold: 100000 })
  await page.reload()
  await expect(page.getByLabel('Large payment threshold')).toHaveValue('1000.00')
  await page.getByLabel('Large payment threshold').fill('0')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible()
  expect(writes.filter((w) => w.path === '/api/settings').at(-1).body.large_payment_threshold).toBe(0)
})

test('dashboard distinguishes early holds from full unpaid bills', async ({ page }) => {
  await mockApi(page, {
    ...complete, held_back: 75000, available: 27000,
    bills: [...complete.bills, { kind: 'expense', id: 3, name: 'Rent', due: '2026-07-01',
      amount: 150000, reserved: 75000, reserve_stage: 'half', overdue: false }],
  })
  await page.goto('/')
  await page.locator('summary').click()
  await expect(page.getByText('− Held back for large payments', { exact: true })).toBeVisible()
  const rent = page.locator('details').getByRole('listitem').filter({ hasText: 'Rent' })
  await expect(rent).toContainText('Early hold toward $1,500.00 unpaid')
  await expect(rent).toContainText('$750.00')
  await expect(page.getByText('$270.00', { exact: true }).first()).toBeVisible()
})

test('semimonthly income collects two calendar pay days', async ({ page }) => {
  const writes = await mockApi(page)
  await page.goto('/income')
  await page.getByRole('button', { name: 'Add Income', exact: true }).first().click()
  await page.getByLabel('Name *', { exact: true }).fill('Salary')
  await page.getByLabel('Amount (per period, post-tax) *', { exact: true }).fill('2000')
  await page.getByLabel('Frequency *', { exact: true }).selectOption('semimonthly')
  await page.getByLabel('First pay day (1–30)').fill('15')
  await page.getByLabel('Second pay day (31 = month end)').fill('31')
  await page.getByRole('button', { name: 'Create Income' }).click()
  await expect(page.getByText('Income created', { exact: true })).toBeVisible()
  expect(writes.find((w) => w.path === '/api/income').body).toMatchObject({ frequency: 'semimonthly', income_day: 15, second_income_day: 31 })
})

test('settings money inputs format dollars and cents without changing saved amounts', async ({ page }) => {
  const writes = await mockApi(page)
  await page.goto('/settings')
  const estimate = page.getByLabel('Monthly living-cost estimate')
  await expect(estimate).toHaveValue('600.00')
  await expect(estimate.locator('..')).toContainText('$')
  await estimate.fill('$1,234.50')
  await page.getByLabel('Minimum cash cushion').fill('.5')
  await page.getByLabel('Large payment threshold').fill('1000')
  await page.getByRole('heading', { name: 'Cash reserves' }).click()
  await expect(estimate).toHaveValue('1234.50')
  await expect(page.getByLabel('Minimum cash cushion')).toHaveValue('0.50')
  await expect(page.getByLabel('Large payment threshold')).toHaveValue('1000.00')
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$1,234.50')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible()
  expect(writes.find((w) => w.path === '/api/settings').body).toMatchObject({ min_checking: 123450, cash_cushion: 50, large_payment_threshold: 100000 })
})

test('categories replace the single estimate and deleting the last restores it', async ({ page }) => {
  const writes = await mockApi(page)
  await page.goto('/settings')
  await page.getByLabel('New category', { exact: true }).fill('Groceries')
  await page.getByLabel('New monthly budget amount').fill('450.5')
  await page.getByRole('button', { name: 'Add category', exact: true }).click()
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$450.50')
  await expect(page.getByLabel('Monthly living-cost estimate')).toHaveCount(0)
  await expect(page.getByLabel('Monthly amount for Groceries')).toHaveValue('450.50')
  expect(writes.find((w) => w.path === '/api/budget/lines').body.amount).toBe(45050)
  await page.getByLabel('Monthly amount for Groceries').fill('500.25')
  await page.getByRole('heading', { name: 'Living costs', exact: true }).click()
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$500.25')
  await page.getByRole('button', { name: 'Remove Groceries' }).click()
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$600.00')
  await expect(page.getByLabel('Monthly living-cost estimate')).toHaveValue('600.00')
})

test('invalid currency stays visible and cannot save settings or a category', async ({ page }) => {
  const writes = await mockApi(page, complete, { lines: [{ id: 1, category: 'groceries', amount: 45000, origin: 'user' }] })
  await page.goto('/settings')
  await page.getByLabel('Monthly amount for groceries').fill('1.234')
  await page.getByRole('heading', { name: 'Living costs', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('up to two decimal places')
  expect(writes).toEqual([])
  await page.getByLabel('Monthly amount for groceries').fill('450')
  await page.getByLabel('Minimum cash cushion').fill('-10')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(page.getByLabel('Minimum cash cushion')).toHaveAttribute('aria-invalid', 'true')
  expect(writes).toEqual([])
  await page.getByLabel('Minimum cash cushion').fill('0')
  await page.getByLabel('New category', { exact: true }).fill('Pet care')
  await page.getByLabel('New monthly budget amount').fill('12abc')
  await page.getByRole('button', { name: 'Add category', exact: true }).click()
  expect(writes).toEqual([])
  await expect(page.getByText('Enter a category and a valid monthly dollar amount before adding it.')).toBeVisible()
})

test('category save failures keep the saved total and show an inline error', async ({ page }) => {
  await mockApi(page, complete, { failBudgetWrites: true, lines: [{ id: 1, category: 'groceries', amount: 45000, origin: 'user' }] })
  await page.goto('/settings')
  await page.getByLabel('Monthly amount for groceries').fill('600')
  await page.getByRole('heading', { name: 'Living costs', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save Groceries')
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$450.00')
})

test('estimates refresh displayed amounts and settings fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockApi(page, complete, {
    settings: { zip_code: '94110', default_payment_account_id: null },
    accounts: [{ id: 1, type: 'checking', name: 'Checking' }],
    lines: [{ id: 1, category: 'groceries', amount: 45000, origin: 'llm_estimate' }],
  })
  await page.goto('/settings')
  await expect(page.getByLabel('Default payment account')).toHaveValue('')
  await expect(page.getByText('Auto-detected:', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Estimate from my area' }).click()
  await expect(page.getByLabel('Monthly amount for groceries')).toHaveValue('555.55')
  await expect(page.getByLabel('Monthly living-cost total')).toHaveText('$555.55')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
