import { useEffect, useRef, useState } from 'react'

// Keep the edit buffer separate from metric state: typing "-", "0." or a new number must not clamp the unfinished input.
export function NumberInput({ value, onValue, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | number; onValue: (value: number) => void | boolean }) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const cancelTimer = () => { if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined } }
  useEffect(() => { if (!focused.current) setDraft(String(value)) }, [value])
  useEffect(() => cancelTimer, [])
  return <input {...props} type="number" value={draft}
    onFocus={() => { focused.current = true }}
    onChange={event => {
      const text = event.target.value
      setDraft(text); cancelTimer()
      const number = Number(event.target.value)
      if (text !== '' && Number.isFinite(number) && number !== Number(value)) timer.current = window.setTimeout(() => { timer.current = undefined; onValue(number) }, 300)
    }}
    onBlur={event => {
      focused.current = false; cancelTimer()
      const number = Number(event.target.value)
      const min = props.min === undefined ? -Infinity : Number(props.min)
      const max = props.max === undefined ? Infinity : Number(props.max)
      if (event.target.value !== '' && Number.isFinite(number)) {
        const bounded = Math.max(min, Math.min(max, number))
        const accepted = bounded === Number(value) || onValue(bounded)
        setDraft(String(accepted === false ? value : bounded))
      } else setDraft(String(value))
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); props.onKeyDown?.(event) }} />
}
