export const ADVISOR_TTL_MS = 24 * 60 * 60 * 1000
export const ADVISOR_STORAGE_PREFIX = 'advisorChat:'

export const RECOMMENDATIONS_PROMPT = 'Review my current finances and give me a concise set of recommendations for right now. Start with what I can safely spend before my next paycheck, then highlight upcoming payments and holds, and suggest my next priorities for debt or savings based on my settings. Use the current account, expense, income, and budget data; flag missing information instead of guessing. Give advice only; do not propose or record any changes.'

export const ADVISOR_PROMPTS = [
  { label: 'Plan my spending', prompt: 'How much can I safely spend before my next paycheck?' },
  { label: 'Look at my debt', prompt: 'Which debt should I focus on paying down next, and why?' },
  { label: 'Review upcoming bills', prompt: 'What payments do I need to plan for before my next paycheck?' },
]

export function advisorStorageKey(userId) {
  return ADVISOR_STORAGE_PREFIX + (userId ?? 'default')
}

function validHistory(data) {
  return Array.isArray(data?.thread) && Array.isArray(data?.apiHistory)
    && Number.isFinite(data?.expiresAt) && data.expiresAt > Date.now()
    && data.expiresAt <= Date.now() + ADVISOR_TTL_MS
}

export function loadAdvisorHistory(userId) {
  try {
    // Remove expired data, including legacy conversations with no expiry date.
    // A closed browser cannot run timers; cleanup happens before any restore.
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(ADVISOR_STORAGE_PREFIX)) continue
      let data
      try { data = JSON.parse(localStorage.getItem(key)) } catch { /* remove below */ }
      if (!validHistory(data)) localStorage.removeItem(key)
    }
    const data = JSON.parse(localStorage.getItem(advisorStorageKey(userId)))
    return validHistory(data) ? data : null
  } catch { return null }
}
