'use client'
import { useState } from 'react'

interface FileInputDEProps {
  label: string
  optional?: boolean
  onChange?: (file: File | null) => void
}

export default function FileInputDE({ label, optional, onChange }: FileInputDEProps) {
  const [fileName, setFileName] = useState<string>('Keine Datei ausgewählt')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    setFileName(file ? file.name : 'Keine Datei ausgewählt')
    if (onChange) onChange(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sand font-semibold text-sm">
        {label} {optional && <span className="opacity-70">(optional)</span>}
      </label>

      <label className="sun-file-input relative flex items-center justify-between">
        <input
          type="file"
          onChange={handleChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <span className="flex items-center gap-3 pointer-events-none w-full justify-between">
          <span className="inline-block px-3 py-1 rounded-md bg-coffee-700 text-sand text-sm font-medium">
            Datei wählen
          </span>
          <span className="text-sand/70 text-sm truncate">{fileName}</span>
        </span>
      </label>
    </div>
  )
}
