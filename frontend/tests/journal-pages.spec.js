import { test, expect } from '@playwright/test'

const series = [
  { date: '2026-06-01', assets: 3600000, debts: 1400000, net: 2200000 },
  { date: '2026-07-01', assets: 3900000, debts: 1300000, net: 2600000 },
  { date: '2026-08-01', assets: 4200000, debts: 1200000, net: 3000000 },
  { date: '2026-09-01', assets: 4380000, debts: 1150000, net: 3230000 },
  { date: '2026-09-22', assets: 4426840, debts: 954500, net: 3472340 },
]
const payment = { id: 12, entity_type: 'account', entity_id: 2, entity_name: 'Chase Sapphire', action: 'pay', amount_delta: -15000, created_at: '2026-09-22T18:30:00Z', correlation_id: 'payment-1', source: 'llm', changes: { balance: { old: 154560, new: 139560 }, payment_made: 15000 } }
const linked = { id: 11, entity_type: 'snapshot', entity_id: 1, entity_name: 'Everyday checking', action: 'create', amount_delta: -15000, created_at: payment.created_at, correlation_id: 'payment-1', source: 'llm', changes: { balance: 426840 } }
const created = { id: 10, entity_type: 'account', entity_id: 3, entity_name: 'Emergency savings', action: 'create', amount_delta: 1600000, created_at: '2026-09-21T16:00:00Z', source: 'user', changes: { name: 'Emergency savings', balance: 1600000 } }
const edited = { id: 13, entity_type: 'account', entity_id: 3, entity_name: 'Emergency savings', action: 'update', amount_delta: null, created_at: '2026-09-23T12:00:00Z', source: 'user', changes: { interest_rate: { old: 3.9, new: 4.1 } } }
const tool = { id: 'tool-1', name: 'pay_account', input: { account_id: 2, amount: 15000, source_account_id: 1 } }
const pending = {
  pending_action_id: 'action-1', text: 'Review this payment before I record it.', tool_use: tool,
  preview: { tool: 'pay_account', account_name: 'Chase Sapphire', current_balance: 154560, new_balance: 139560, payment_made: 15000, interest_portion: 1000, principal_portion: 14000, source: { account_name: 'Everyday checking', new_balance: 426840 }, warnings: ['This payment uses your checking balance.'] },
}
const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')

async function mockJournal(page, { chatMode = 'text', empty = false, holdResponse, failedConfirmation = false } = {}) {
  const requests = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push({ method: request.method(), path: url.pathname + url.search, body: request.postData() ? request.postDataJSON() : null })
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 1, email: 'test@example.com' } })
    if (url.pathname === '/api/history/net-worth') return route.fulfill({ json: { series: empty ? [] : series } })
    if (url.pathname === '/api/events') {
      const all = url.searchParams.get('all') === 'true'
      const more = url.searchParams.has('cursor')
      return route.fulfill({ json: { events: empty ? [] : more ? [linked, created] : all ? [edited, payment] : [payment], next_cursor: empty || more ? null : 12 } })
    }
    if (url.pathname === '/api/ai/chat') {
      if (holdResponse) await holdResponse
      if (chatMode === 'error') return route.fulfill({ status: 503, json: {} })
      const events = chatMode === 'pending'
        ? [['text', { text: pending.text }], ['pending_action', pending], ['done', {}]]
        : [['text', { text: 'Keep **$750.00** set aside ' }], ['text', { text: 'for rent before moving money into savings.' }], ['done', {}]]
      return route.fulfill({ contentType: 'text/event-stream', body: sse(events) })
    }
    if (url.pathname.startsWith('/api/ai/actions/')) {
      if (failedConfirmation) return route.fulfill({ status: 409, json: { detail: 'The balance changed. Please review a new proposal.' } })
      const message = url.pathname.endsWith('/confirm') ? 'Payment recorded.' : 'Change cancelled.'
      return route.fulfill({ json: { message, tool_result: { type: 'tool_result', tool_use_id: tool.id, content: message } } })
    }
    throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`)
  })
  return requests
}

test('chat drafts without requests, streams, persists, and confirms clearing', async ({ page }) => {
  let release
  const held = new Promise((resolve) => { release = resolve })
  const requests = await mockJournal(page, { holdResponse: held })
  await page.goto('/chat')
  const input = page.getByRole('textbox', { name: 'Message your advisor' })
  await page.getByRole('button', { name: 'Plan my spending' }).click()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('How much can I safely spend before my next paycheck?')
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
  await input.press('End')
  await input.press('Shift+Enter')
  await input.pressSequentially('Include rent.')
  const prompt = (await input.inputValue()).trim()
  expect(prompt).toContain('\n')
  await input.press('Enter')
  await expect(input).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('log')).toContainText('Keep $750.00 set aside for rent')
  await expect(input).toBeEnabled()
  expect(requests.find((r) => r.path === '/api/ai/chat')).toEqual({ method: 'POST', path: '/api/ai/chat', body: { messages: [{ role: 'user', content: prompt }] } })
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Keep $750.00')
  await page.reload()
  await expect(page.getByRole('log')).toContainText('Keep $750.00')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('log')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('log')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'More clarity. A confident next step.' })).toBeVisible()
})

for (const action of ['Confirm', 'Cancel']) {
  test(`chat ${action.toLowerCase()} preserves proposal details and action contract`, async ({ page }) => {
    const requests = await mockJournal(page, { chatMode: 'pending' })
    await page.goto('/chat')
    await page.getByRole('textbox').fill('Pay $150 to Chase from checking')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const preview = page.locator('.advisor-preview')
    await expect(preview.getByRole('heading', { name: 'Confirm debt payment' })).toBeVisible()
    await expect(preview).toContainText('$1,395.60')
    await expect(preview).toContainText('$4,268.40')
    await expect(preview).toContainText('This payment uses your checking balance.')
    expect(requests.filter((r) => r.path.includes('/actions/'))).toHaveLength(0)
    await preview.getByRole('button', { name: action, exact: true }).click()
    const message = action === 'Confirm' ? 'Payment recorded.' : 'Change cancelled.'
    await expect(page.getByRole('log')).toContainText(message)
    await expect(preview).toHaveCount(0)
    expect(requests.find((r) => r.path.includes('/actions/'))).toEqual({ method: 'POST', path: `/api/ai/actions/action-1/${action.toLowerCase()}`, body: null })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('advisorChat:1')).apiHistory.at(-1))).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: message }] })
  })
}

test('chat displays send and confirmation failures by the composer', async ({ page }) => {
  await mockJournal(page, { chatMode: 'error' })
  await page.goto('/chat')
  await page.getByRole('textbox').fill('Review my budget')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The advisor is unavailable')
  await expect(page.getByRole('textbox')).toBeEnabled()
  await page.unroute('**/api/**')
  await mockJournal(page, { chatMode: 'pending', failedConfirmation: true })
  await page.getByRole('textbox').fill('Pay $150 to Chase')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The balance changed. Please review a new proposal.')
  await expect(page.getByRole('log')).not.toContainText('Payment recorded.')
})

test('history retains chart controls, grouping, pagination, and all-activity filter', async ({ page }) => {
  const requests = await mockJournal(page)
  await page.goto('/history')
  const summary = page.getByRole('region', { name: 'Net worth history', exact: true })
  await expect(summary).toContainText('$34,723.40')
  await expect(summary).toContainText('+$2,423.40')
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await expect(page.getByRole('img', { name: /^Assets over time/ })).toBeVisible()
  await page.getByRole('button', { name: '1M', exact: true }).click()
  await expect(page.getByRole('button', { name: '1M', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('img', { name: /Assets over time, last 1M/ })).toBeVisible()
  const row = page.getByRole('button', { name: /Chase Sapphire.*Paid/ })
  await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.activity-row-details')).toContainText('$1,545.60')
  await expect(page.locator('.activity-row-details')).toContainText('$1,395.60')
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.activity-row')).toHaveCount(2)
  await expect(row).toContainText('2 changes')
  await expect(page.locator('.activity-row-details')).toContainText('Everyday checking')
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
  expect(requests.some((r) => r.path === '/api/events?cursor=12')).toBe(true)
  await page.getByRole('button', { name: 'Show all activity', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Showing all activity' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /Emergency savings Updated/ })).toBeVisible()
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.locator('.activity-row')).toHaveCount(3)
  expect(requests.some((r) => r.path === '/api/events?all=true&cursor=12')).toBe(true)
  expect(requests.every((r) => r.method === 'GET')).toBe(true)
})

test('empty history offers accounts without invented balances', async ({ page }) => {
  await mockJournal(page, { empty: true })
  await page.goto('/history')
  await expect(page.getByText('Add an account to start tracking your net worth.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Go to accounts' })).toHaveAttribute('href', '/accounts')
  await expect(page.getByText('No activity yet')).toBeVisible()
  await expect(page.locator('.history-snapshot')).toHaveCount(0)
})

for (const path of ['chat', 'history']) {
  test(`${path} mobile content works without overflow or browser errors`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 390, height: 844 })
    await mockJournal(page, { chatMode: 'pending' })
    await page.goto(`/${path}`)
    if (path === 'chat') {
      await page.getByRole('textbox').fill('Pay $150 to Chase')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    } else {
      await page.getByRole('button', { name: /Chase Sapphire.*Paid/ }).click()
      await expect(page.locator('.activity-row-details')).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
