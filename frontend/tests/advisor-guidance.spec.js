import { test, expect } from '@playwright/test'
import { ADVISOR_TTL_MS, ADVISOR_PROMPTS, RECOMMENDATIONS_PROMPT } from '../src/lib/advisor'

const key = 'advisorChat:1'
const sse = events => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')

async function mockAdvisor(page, { pending = false, holdResponse } = {}) {
  const requests = []
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 1, email: 'test@example.com' } })
    if (path === '/api/history/net-worth') return route.fulfill({ json: { series: [] } })
    if (path === '/api/events') return route.fulfill({ json: { events: [], next_cursor: null } })
    if (path === '/api/ai/chat') {
      requests.push(request.postDataJSON())
      const number = requests.length
      if (holdResponse) await holdResponse
      const events = [['text', { text: `Answer ${number}: Keep your rent money set aside.` }]]
      if (pending) events.push(['pending_action', { pending_action_id: 'action-1', text: 'Review this payment.', tool_use: { id: 'tool-1', name: 'pay_account', input: { account_id: 2, amount: 15000 } }, preview: { tool: 'pay_account', account_name: 'Card', payment_made: 15000 } }])
      events.push(['done', {}])
      return route.fulfill({ contentType: 'text/event-stream', body: sse(events) })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  return requests
}

async function ask(page, text) {
  await page.getByRole('textbox', { name: 'Message your advisor' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('textbox')).toBeEnabled()
}

test('recommendations require a click; presets send immediately and start fresh', async ({ page }) => {
  const requests = await mockAdvisor(page)
  await page.goto('/chat')
  await expect(page.getByRole('button', { name: 'Ask advisor', exact: true })).toBeVisible()
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Ask advisor', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Answer 1:')
  expect(requests[0]).toEqual({ messages: [{ role: 'user', content: RECOMMENDATIONS_PROMPT }] })
  for (const [index, prompt] of ADVISOR_PROMPTS.entries()) {
    await page.getByRole('button', { name: prompt.label }).click()
    await expect(page.getByRole('log')).toContainText(`Answer ${index + 2}:`)
    expect(requests[index + 1]).toEqual({ messages: [{ role: 'user', content: prompt.prompt }] })
  }
  await page.reload()
  await expect(page.getByRole('log')).toContainText('Answer 4:')
  expect(requests).toHaveLength(4)
})

test('top-bar Ask advisor generates exactly one response and navigation alone does not', async ({ page }) => {
  const requests = await mockAdvisor(page)
  await page.goto('/history')
  await page.getByRole('button', { name: 'Ask advisor', exact: true }).click()
  await expect(page).toHaveURL('/chat')
  await expect(page.getByRole('log')).toContainText('Answer 1:')
  expect(requests).toEqual([{ messages: [{ role: 'user', content: RECOMMENDATIONS_PROMPT }] }])
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Answer 1:')
  expect(requests).toHaveLength(1)
})

test('follow-ups retain context while older messages are hidden by default', async ({ page }) => {
  const requests = await mockAdvisor(page)
  await page.goto('/chat')
  await ask(page, 'What can I spend?')
  await ask(page, 'What about groceries?')
  await expect(page.getByRole('log')).toContainText('Answer 2:')
  await expect(page.getByRole('log')).not.toContainText('Answer 1:')
  expect(requests[1].messages).toHaveLength(3)
  expect(requests[1].messages[0].content).toBe('What can I spend?')
  await page.getByRole('button', { name: 'Show this conversation' }).click()
  await expect(page.getByRole('log')).toContainText('Answer 1:')
  await expect(page.getByRole('log')).toContainText('What about groceries?')
  await page.reload()
  await expect(page.getByRole('log')).not.toContainText('Answer 1:')
  await expect(page.getByRole('log')).toContainText('Answer 2:')
})

test('open conversations and unsent drafts expire at 24 hours, without extension by follow-ups', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
  const requests = await mockAdvisor(page)
  await page.goto('/chat')
  await ask(page, 'Original private question')
  const deadline = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).expiresAt, key)
  await page.clock.fastForward(23 * 60 * 60 * 1000)
  await ask(page, 'Follow up before expiry')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).expiresAt, key)).toBe(deadline)
  await page.getByRole('textbox').fill('Unsent private draft')
  await page.clock.fastForward(60 * 60 * 1000 + 1000)
  await expect(page.getByRole('log')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveValue('')
  await expect(page.getByText(/Your conversation expired after 24 hours/)).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
  await ask(page, 'A new question')
  expect(requests.at(-1)).toEqual({ messages: [{ role: 'user', content: 'A new question' }] })
})

for (const format of ['expired', 'legacy', 'malformed']) {
  test(`${format} saved conversations are removed before they can be displayed or sent`, async ({ page }) => {
    const requests = await mockAdvisor(page)
    await page.addInitScript(({ key, format }) => {
      const data = { thread: [{ role: 'assistant', content: 'Old private answer' }], apiHistory: [{ role: 'user', content: 'Old private question' }] }
      if (format === 'expired') data.expiresAt = Date.now() - 1000
      localStorage.setItem(key, format === 'malformed' ? '{bad json' : JSON.stringify(data))
    }, { key, format })
    await page.goto('/chat')
    await expect(page.getByRole('heading', { name: 'What would help today?' })).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await ask(page, 'New question')
    expect(requests[0].messages).toEqual([{ role: 'user', content: 'New question' }])
  })
}

test('late responses cannot resurrect an expired conversation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
  let release
  const holdResponse = new Promise(resolve => { release = resolve })
  const requests = await mockAdvisor(page, { holdResponse })
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Ask advisor', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  await page.clock.fastForward(ADVISOR_TTL_MS + 1000)
  await expect(page.getByRole('log')).toHaveCount(0)
  release()
  await expect(page.getByRole('textbox')).toBeEnabled()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
  await ask(page, 'Fresh question')
  await expect(page.getByRole('log')).toContainText('Answer 2:')
  expect(requests[1].messages).toEqual([{ role: 'user', content: 'Fresh question' }])
})

test('pending proposals block new prompts and cannot be confirmed after conversation expiry', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
  const requests = await mockAdvisor(page, { pending: true })
  await page.goto('/chat')
  await page.getByRole('textbox').fill('Pay my card')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask advisor', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Plan my spending' })).toBeDisabled()
  await expect(page.getByRole('textbox')).toBeDisabled()
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  await page.clock.fastForward(ADVISOR_TTL_MS + 1000)
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toBeEnabled()
})

test('a restored conversation keeps its original deadline', async ({ page }) => {
  const expiresAt = Date.now() + 60_000
  await mockAdvisor(page)
  await page.addInitScript(({ key, expiresAt }) => localStorage.setItem(key, JSON.stringify({
    thread: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Recent answer' }],
    apiHistory: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Recent answer' }], expiresAt,
  })), { key, expiresAt })
  await page.clock.install()
  await page.goto('/chat')
  await expect(page.getByRole('log')).toContainText('Recent answer')
  await page.clock.fastForward(61_000)
  await expect(page.getByRole('log')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
})
