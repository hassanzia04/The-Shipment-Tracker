import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import clsx from 'clsx'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard API is unavailable over plain http — fall back to execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function CopyButton({ text, title = 'Copy', size = 12, className }: {
  text: string
  title?: string
  size?: number
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async e => {
        e.stopPropagation()
        e.preventDefault()
        await copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title={copied ? 'Copied!' : title}
      className={clsx(
        'inline-flex items-center align-middle p-0.5 rounded transition-colors shrink-0',
        copied
          ? 'text-green-500'
          : 'text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400',
        className,
      )}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}
