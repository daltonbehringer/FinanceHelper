export default function SortableHeader({ label, sortKey, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === sortKey
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-3 font-medium text-text-subtle cursor-pointer select-none hover:text-text transition-colors ${className}`}
    >
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1">
        {label}
        <svg
          aria-hidden="true"
          className={`w-3.5 h-3.5 transition-transform ${active ? 'text-text' : 'text-border-strong'} ${active && sortDir === 'desc' ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </th>
  )
}
