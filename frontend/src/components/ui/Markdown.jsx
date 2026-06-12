import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Tailwind v4 here has no typography plugin, so style elements directly rather
// than relying on `prose`. Shared by the advisor chat and the dashboard
// recommendation card.
const MD_COMPONENTS = {
  h1: (p) => <h1 className="text-base font-bold text-text mt-3 first:mt-0" {...p} />,
  h2: (p) => <h2 className="text-sm font-bold text-text mt-3 first:mt-0" {...p} />,
  h3: (p) => <h3 className="text-sm font-semibold text-text mt-2 first:mt-0" {...p} />,
  p: (p) => <p className="text-sm text-text-muted leading-relaxed my-1.5 first:mt-0" {...p} />,
  ul: (p) => <ul className="list-disc pl-5 my-1.5 space-y-1 text-sm text-text-muted" {...p} />,
  ol: (p) => <ol className="list-decimal pl-5 my-1.5 space-y-1 text-sm text-text-muted" {...p} />,
  li: (p) => <li className="text-sm text-text-muted" {...p} />,
  strong: (p) => <strong className="font-semibold text-text" {...p} />,
  a: (p) => <a className="text-accent underline" {...p} />,
  code: (p) => <code className="rounded bg-surface-raised px-1 py-0.5 text-xs text-text" {...p} />,
}

export default function Markdown({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {children || ''}
    </ReactMarkdown>
  )
}
