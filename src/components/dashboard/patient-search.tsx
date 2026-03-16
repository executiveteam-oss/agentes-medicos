'use client'

// ============================================================
// PatientSearch — Dropdown buscable para seleccionar paciente
// Reutilizable en: citas, cartera, lista de espera
// ============================================================

import { useState, useRef, useEffect, useTransition } from 'react'
import { searchPatientsForSelect } from '@/app/actions/patients'

interface PatientOption {
  id: string
  name: string
  phone: string
}

interface PatientSearchProps {
  value: string                         // patient_id seleccionado
  onChange: (id: string, name: string) => void
  placeholder?: string
}

export function PatientSearch({ value, onChange, placeholder }: PatientSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientOption[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [selectedName, setSelectedName] = useState('')
  const [isPending, startTransition] = useTransition()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleInputChange(val: string) {
    setQuery(val)
    setIsOpen(true)

    // Si borró el input, limpiar selección
    if (!val.trim()) {
      setResults([])
      return
    }

    // Debounce la búsqueda
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const data = await searchPatientsForSelect(val)
        setResults(data)
      })
    }, 300)
  }

  function handleSelect(patient: PatientOption) {
    onChange(patient.id, patient.name)
    setSelectedName(patient.name)
    setQuery(patient.name)
    setIsOpen(false)
  }

  function handleClear() {
    onChange('', '')
    setSelectedName('')
    setQuery('')
    setResults([])
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={value && selectedName ? selectedName : query}
          onChange={(e) => {
            if (value) handleClear()
            handleInputChange(e.target.value)
          }}
          onFocus={() => { if (query.trim()) setIsOpen(true) }}
          placeholder={placeholder ?? 'Buscar paciente por nombre o teléfono...'}
          className="input-field w-full"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-slate-400 hover:text-slate-600"
          >
            &times;
          </button>
        )}
      </div>

      {isOpen && (query.trim().length > 0) && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isPending ? (
            <div className="px-4 py-3 text-slate-400 text-sm">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-slate-400 text-sm">Sin resultados</div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between"
              >
                <span className="text-sm font-medium text-slate-900">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {p.phone.replace('+57', '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
