import { useId, useState } from 'react'
import Input from './Input'
import { moneyInputCents } from '../../lib/utils'

const pattern = '(?:[0-9]+(?:\\.[0-9]{0,2})?|\\.[0-9]{1,2})'
const validAmount = (value) => moneyInputCents(value) !== null

// Values passed to callers remain ungrouped dollar strings; APIs receive cents.
export default function MoneyInput({ value, defaultValue = '', onValueChange, onCommit, className, ...props }) {
  const [localValue, setLocalValue] = useState(defaultValue)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const errorId = useId()
  const raw = String(value ?? localValue)
  const displayed = !editing && validAmount(raw) ? Number(raw).toFixed(2) : raw

  function update(next) {
    if (value === undefined) setLocalValue(next)
    onValueChange?.(next)
  }

  function validate(input, next) {
    const message = next === '' && !props.required ? ''
      : validAmount(next) ? '' : 'Enter a dollar amount of zero or more, with up to two decimal places.'
    input.setCustomValidity(message)
    return message
  }

  return (
    <div className={className}>
      <Input
        {...props}
        prefix="$"
        type="text"
        inputMode="decimal"
        pattern={pattern}
        placeholder="0.00"
        value={displayed}
        aria-invalid={error ? true : undefined}
        aria-describedby={[props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined}
        onChange={(event) => {
          // Accept pasted currency such as "$1,234.50" without changing its value.
          const next = event.target.value.trim().replace(/^\$\s*/, '').replaceAll(',', '')
          validate(event.target, next)
          setEditing(true)
          setError('')
          update(next)
        }}
        onInvalid={(event) => setError(validate(event.target, raw))}
        onBlur={(event) => {
          setEditing(false)
          const message = validate(event.target, raw)
          setError(message)
          if (!message) {
            const next = raw === '' ? '' : Number(raw).toFixed(2)
            update(next)
            onCommit?.(next)
          }
        }}
      />
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-debit">{error}</p>}
    </div>
  )
}
