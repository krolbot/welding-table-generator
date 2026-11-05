import { useEffect, useRef, useState } from 'react'

// Keep the edit buffer separate from metric state: typing "-", "0." or a new number must not clamp the unfinished input.
export function NumberInput({ value, onValue, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(String(value)) }, [value])
  return <input {...props} type="number" value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      setDraft(event.target.value)
      const number = Number(event.target.value)
      if (event.target.value !== '' && Number.isFinite(number)) onValue(number)
    }}
    onBlur={event => {
      focused.current = false
      const number = Number(event.target.value)
      const min = props.min === undefined ? -Infinity : Number(props.min)
      const max = props.max === undefined ? Infinity : Number(props.max)
      if (event.target.value !== '' && Number.isFinite(number)) {
        const bounded = Math.max(min, Math.min(max, number))
        onValue(bounded)
        setDraft(String(bounded))
      } else setDraft(String(value))
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); props.onKeyDown?.(event) }} />
}
