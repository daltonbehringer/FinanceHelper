import AdvisorChat from '../components/dashboard/AdvisorChat'

export default function Chat() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Chat</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ask questions, record payments, or update balances in plain language. Your full
          history lives here — including anything you asked from the dashboard.
        </p>
      </div>

      <AdvisorChat variant="full" />
    </div>
  )
}
