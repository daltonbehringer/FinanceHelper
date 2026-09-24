import { useNavigate } from 'react-router-dom'
import { useAdvisorChatContext } from '../context/AdvisorChatContext'
import { RECOMMENDATIONS_PROMPT } from '../lib/advisor'

// A deliberate click generates guidance. Merely visiting /chat never calls AI.
export default function AskAdvisorButton({ children, className }) {
  const navigate = useNavigate()
  const { send, pending, busy } = useAdvisorChatContext()
  function ask() {
    navigate('/chat')
    if (!pending && !busy) send(RECOMMENDATIONS_PROMPT, { fresh: true })
  }
  return <button type="button" className={className} onClick={ask}>
    {children || (pending ? 'Review proposal' : busy ? 'View response' : 'Ask advisor')}
  </button>
}
