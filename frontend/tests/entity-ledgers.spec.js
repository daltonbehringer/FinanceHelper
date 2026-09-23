import { test, expect } from '@playwright/test'

const initialAccounts = [
  { id: 1, name: 'Everyday checking', type: 'checking', balance: 426840, current_balance: 426840, is_active: 1 },
  { id: 2, name: 'Emergency savings', type: 'savings', balance: 1600000, current_balance: 1600000, interest_rate: 4.1, is_active: 1 },
  { id: 3, name: 'Investment portfolio', type: 'brokerage', balance: 2400000, current_balance: 2400000, is_active: 1 },
  { id: 4, name: 'Chase Sapphire', type: 'credit_card', balance: 139560, current_balance: 139560, minimum_payment: 8500, due_date: '2026-06-14', interest_rate: 19.99, credit_limit: 1500000, is_active: 1 },
  { id: 5, name: 'Auto loan', type: 'loan', balance: 815000, current_balance: 815000, minimum_payment: 31000, due_date: '2026-06-22', interest_rate: 5.49, is_active: 1 },
  { id: 6, name: 'Old checking', type: 'checking', balance: 900000, current_balance: 900000, is_active: 0 },
]
const initialExpenses = [
  { id: 1, name: 'Rent', amount: 150000, category: 'Housing', is_recurring: 1, due_day: 1, next_due_date: '2026-07-01', is_active: 1 },
  { id: 2, name: 'Electric & water', amount: 8950, category: 'Utilities', is_recurring: 1, due_day: 12, next_due_date: '2026-06-12', is_active: 1 },
  { id: 3, name: 'Internet', amount: 6500, category: 'Utilities', is_recurring: 1, due_day: 18, next_due_date: '2026-06-18', is_active: 1 },
  { id: 4, name: 'Car registration', amount: 8500, category: 'Transport', is_recurring: 0, due_date: '2026-06-30', is_active: 1 },
  { id: 5, name: 'Auto loan payment', amount: 31000, category: 'Transport', is_recurring: 1, linked_account_id: 5, due_day: 22, next_due_date: '2026-06-22', is_active: 1 },
]
const initialIncome = [
  { id: 1, name: 'Salary', amount: 285000, frequency: 'biweekly', last_pay_date: '2026-06-06', next_payday: '2026-06-20', is_active: 1 },
  { id: 2, name: 'Freelance retainer', amount: 85000, frequency: 'monthly', income_day: 1, last_pay_date: '2026-06-01', next_payday: '2026-07-01', is_active: 1 },
]

async function mockLedgers(page, { failPayments = false } = {}) {
  const data = { accounts: structuredClone(initialAccounts), expenses: structuredClone(initialExpenses), income: structuredClone(initialIncome) }
  const writes = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const [, , kind, idText, action] = url.pathname.split('/')
    const items = data[kind]
    if (request.method() === 'GET') {
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 1, email: 'test@example.com' } })
      if (url.pathname === '/api/settings') return route.fulfill({ json: { default_payment_account_id: 1 } })
      if (url.pathname === '/api/meta/account-fields') return route.fulfill({ json: { types: initialAccounts.map((a) => ({ value: a.type, label: a.type, fields: [{ name: 'balance', label: 'Balance', kind: 'money', required: true }] })).filter((a, i, all) => all.findIndex((b) => a.value === b.value) === i) } })
      if (items) return route.fulfill({ json: items.filter((item) => url.searchParams.get('include_inactive') === '1' || item.is_active) })
      return route.fulfill({ json: [] })
    }
    const body = request.postData() ? request.postDataJSON() : null
    writes.push({ method: request.method(), path: url.pathname, body })
    const item = items?.find((entry) => entry.id === Number(idText))
    if (action === 'pay') {
      if (failPayments) return route.fulfill({ status: 500, json: { detail: 'Could not record' } })
      if (kind === 'accounts') {
        item.current_balance -= body.amount
        data.accounts.find((a) => a.id === body.source_account_id).current_balance -= body.amount
      } else item.next_due_date = '2026-07-12'
    } else if (action === 'deactivate') item.is_active = 0
    else if (request.method() === 'PUT') Object.assign(item, body)
    else throw new Error(`Unexpected write: ${request.method()} ${url.pathname}`)
    return route.fulfill({ json: item })
  })
  return writes
}

test('account filters, search, inactive entries, and sorting preserve list operations', async ({ page }) => {
  await mockLedgers(page)
  await page.goto('/accounts')
  const summary = page.getByRole('region', { name: 'Accounts summary' })
  await expect(summary).toContainText('$34,722.80')
  await page.getByRole('button', { name: /^Debt / }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByLabel('Search accounts').fill('Chase')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Search accounts').fill('Not present')
  await expect(page.getByRole('heading', { name: 'No matching accounts.' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Show inactive').check()
  await expect(page.locator('tbody')).toContainText('Old checking')
  await expect(summary).toContainText('$34,722.80')
  await page.getByRole('button', { name: 'Name', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toContainText('Auto loan')
})

test('debt and expense payments retain their exact request contracts', async ({ page }) => {
  const writes = await mockLedgers(page)
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Actions for Chase Sapphire', exact: true }).click()
  await page.getByRole('button', { name: 'Pay', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Pay Chase Sapphire' })).toBeVisible()
  await page.getByLabel('Amount', { exact: true }).fill('90.25')
  await page.getByLabel('Note (optional)').fill('Extra payment')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Paid Chase Sapphire', { exact: true })).toBeVisible()
  expect(writes[0]).toEqual({ method: 'POST', path: '/api/accounts/4/pay', body: { amount: 9025, source_account_id: 1, note: 'Extra payment' } })
  await expect(page.locator('tbody tr').filter({ hasText: 'Chase Sapphire' })).toContainText('$1,305.35')
  await page.goto('/expenses')
  await expect(page.getByRole('region', { name: 'Expenses summary' })).toContainText('$1,654.50')
  await page.getByRole('button', { name: 'Actions for Auto loan payment', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Actions for Auto loan payment', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for Electric & water', exact: true }).click()
  await page.getByRole('button', { name: 'Pay', exact: true }).click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Paid Electric & water', { exact: true })).toBeVisible()
  expect(writes[1]).toEqual({ method: 'POST', path: '/api/expenses/2/pay', body: { source_account_id: 1, source_new_balance: 408865, note: null } })
  await expect(page.locator('tbody tr').filter({ hasText: 'Electric & water' })).toContainText('Jul 12, 2026')
})

test('income receipts and confirmed deactivation keep existing API paths', async ({ page }) => {
  const writes = await mockLedgers(page)
  await page.goto('/income')
  await expect(page.getByRole('region', { name: 'Income summary' })).toContainText('$7,025.00')
  await page.getByRole('button', { name: 'Actions for Salary', exact: true }).click()
  await page.getByRole('button', { name: 'Mark Paid', exact: true }).click()
  await expect(page.getByText('Salary marked as paid', { exact: true })).toBeVisible()
  expect(writes[0]).toEqual({ method: 'PUT', path: '/api/income/1', body: { last_pay_date: new Date().toISOString().split('T')[0] } })
  await page.getByRole('button', { name: 'Actions for Freelance retainer', exact: true }).click()
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Deactivate income?' })
  await expect(dialog).toBeVisible()
  expect(writes).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await expect(page.locator('tbody')).not.toContainText('Freelance retainer')
  expect(writes[1]).toEqual({ method: 'POST', path: '/api/income/2/deactivate', body: null })
})

test('failed payment leaves the dialog and recorded balance intact', async ({ page }) => {
  const writes = await mockLedgers(page, { failPayments: true })
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Actions for Chase Sapphire', exact: true }).click()
  await page.getByRole('button', { name: 'Pay', exact: true }).click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText('Failed to record payment', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(writes).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('tbody tr').filter({ hasText: 'Chase Sapphire' })).toContainText('$1,395.60')
})

for (const [path, title, entry] of [['accounts', 'Accounts', 'Chase Sapphire'], ['expenses', 'Expenses', 'Rent'], ['income', 'Income', 'Salary']]) {
  test(`${title} supports mobile row actions, edit dialogs, and keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await mockLedgers(page)
    await page.goto(`/${path}`)
    await expect(page.getByRole('heading', { name: `${title}.`, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: `Actions for ${entry}`, exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close dialog' }).focus()
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true)
    await page.evaluate(() => document.querySelector('.ledger-add-button').focus())
    expect(await page.evaluate(() => document.querySelector('dialog:modal').contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.querySelector('dialog:modal').contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
