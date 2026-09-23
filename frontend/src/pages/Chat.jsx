import AdvisorChat from '../components/dashboard/AdvisorChat'
import '../styles/journal.css'

export default function Chat() {
  return (
    <div className="journal-page chat-page">
      <header className="journal-header">
        <p className="journal-kicker">A LITTLE PERSPECTIVE</p>
        <h1>Chat.</h1>
        <p className="journal-description">
          Think through your next move. Ask a question, record a payment,
          or update a balance in your own words.
        </p>
      </header>

      <AdvisorChat variant="full" />
    </div>
  )
}
