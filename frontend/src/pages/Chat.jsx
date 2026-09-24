import AdvisorChat from '../components/dashboard/AdvisorChat'
import { useAdvisorChatContext } from '../context/AdvisorChatContext'
import '../styles/journal.css'

export default function Chat() {
  const { expiresAt } = useAdvisorChatContext()
  return (
    <div className="journal-page chat-page">
      <header className="journal-header">
        <p className="journal-kicker">A LITTLE PERSPECTIVE</p>
        <h1>Your advisor.</h1>
        <p className="journal-description">
          A clear answer, a next step. Get recommendations or ask about what matters to you.
        </p>
      </header>
      <AdvisorChat key={expiresAt || 'new'} />
    </div>
  )
}
