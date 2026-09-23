import { test, expect } from '@playwright/test'

const complete = {
  complete: true, issues: [], available: 102000, projected_balance: 102000, shortfall: 0,
  checking_balance: 200000, checking_label: 'Checking',
  next_payday: { date: '2026-06-20', amount: 200000, name: 'Salary' },
  account_payments: 30000, expense_payments: 50000, living_costs: 18000, cash_cushion: 0,
  bills: [{ kind: 'account', id: 2, name: 'Card payment', due: '2026-06-15', amount: 30000, overdue: false }],
}

async function mockApi(page, summary = complete) {
  let settings = { min_checking: 60000, cash_cushion: 0, living_budget_configured: 1 }
  const writes = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      const body = request.postDataJSON()
      writes.push({ path, body })
      if (path === '/api/settings') settings = { ...settings, ...body }
      return route.fulfill({ json: { id: 1, ...body } })
    }
    const data = path === '/api/auth/me' ? { id: 1, email: 'test@example.com' }
      : path === '/api/dashboard/safe-to-spend' ? summary
      : path === '/api/settings' ? settings
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

test('settings saves living costs separately from the cash cushion', async ({ page }) => {
  const writes = await mockApi(page)
  await page.goto('/settings')
  await page.getByLabel('Fallback monthly living costs').fill('900')
  await page.getByLabel('Minimum cash cushion').fill('100')
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible()
  expect(writes.find((w) => w.path === '/api/settings').body).toMatchObject({ min_checking: 90000, cash_cushion: 10000 })
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
