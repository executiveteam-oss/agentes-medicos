'use client'

// ============================================================
// AppointmentFormModal — Modal para crear/editar citas desde dashboard
// Usa PatientSearch para seleccionar paciente, con soporte de
// tipo de pago (EPS, Particular, etc.) y validación inline.
// ============================================================

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { PatientSearch } from '@/components/dashboard/patient-search'
import {
  createAppointment,
  updateAppointmentFromDashboard,
} from '@/app/actions/appointments'
import type { AppointmentInput } from '@/app/actions/appointments'
import type { PaymentType, AppointmentModality } from '@/types/database'
import {
  agruparPorMedico, filtrarGrupos, rangoDePrecios, precioCorto, CONVENIO_NO_LISTADO,
  type OpcionServicio,
} from '@/lib/consultation-types/opciones-agendamiento'

interface DoctorOption {
  id: string
  name: string
  specialty: string | null
}

interface InitialData {
  id: string
  patient_id: string
  patient_name: string
  doctor_id: string
  date: string        // YYYY-MM-DD
  time: string        // HH:mm
  duration_minutes: number
  reason: string
  payment_type: PaymentType
  eps_name: string
  desired_at?: string | null  // YYYY-MM-DD
  modality?: AppointmentModality
  virtual_link?: string | null
}

interface AppointmentFormModalProps {
  isOpen: boolean
  onClose: () => void
  doctors: DoctorOption[]
  /** El catálogo de servicios. OPCIONAL a propósito: el modal se usa en tres
   *  pantallas y sólo la agenda lo pasa por ahora. Sin esto, el formulario se
   *  comporta como siempre (Motivo en texto libre). */
  consultationTypes?: OpcionServicio[]
  initialData?: InitialData
  /** Pre-selecciona la paciente en una cita NUEVA (ej. aprobar autorización). */
  prefillPatient?: { id: string; name: string }
  minBookingAdvanceHours?: number
  /** La secretaria ya vio la advertencia de "fuera de horario" y confirmó.
   *  Viaja hasta el server action: la advertencia del cliente no alcanza. */
  fueraDeHorarioConfirmado?: boolean
  onSaved: () => void
}

const PAYMENT_TYPES: PaymentType[] = ['Particular', 'EPS', 'Prepagada', 'Póliza', 'ARL', 'SOAT']

import { EPS_OPTIONS } from '@/lib/utils/eps-options'

export function AppointmentFormModal({
  isOpen,
  onClose,
  doctors,
  consultationTypes,
  initialData,
  prefillPatient,
  minBookingAdvanceHours,
  fueraDeHorarioConfirmado,
  onSaved,
}: AppointmentFormModalProps) {
  const isEditing = !!initialData?.id

  // --- Estado del formulario ---
  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [reason, setReason] = useState('')
  /** Servicio elegido (clave del grupo) + búsqueda + convenio. */
  const [servicioKey, setServicioKey] = useState('')
  const [busquedaServicio, setBusquedaServicio] = useState('')
  /** id del consultation_type, o CONVENIO_NO_LISTADO. */
  const [convenioSel, setConvenioSel] = useState('')
  const [convenioLibre, setConvenioLibre] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('Particular')
  const [epsName, setEpsName] = useState('')
  const [modality, setModality] = useState<AppointmentModality>('presencial')
  // Aviso a la paciente cuando la cita se MUEVE. Por defecto se avisa; el
  // silencio existe pero cuesta un motivo, igual que cancelar.
  const [avisarPaciente, setAvisarPaciente] = useState(true)
  const [motivoPaciente, setMotivoPaciente] = useState('')
  const [motivoInterno, setMotivoInterno] = useState('')
  /** Mensaje del server cuando el cupo ya está ocupado: dice QUIÉN está ahí.
   *  Mientras esté seteado, el submit agenda como EXTRA. */
  const [confirmarExtra, setConfirmarExtra] = useState<string | null>(null)
  /** Igual que confirmarExtra, para el horario fuera de franja.
   *
   *  🔴 POR QUÉ (2026-08-21): el override `fuera_de_horario_confirmado` existía
   *  desde siempre, pero SOLO se podía activar haciendo clic en una celda
   *  cerrada de la grilla semanal — antes de abrir el formulario. Quien abría
   *  "Nueva cita" desde el botón, o cambiaba la hora acá adentro, se topaba con
   *  un mensaje rojo sin salida. La capacidad estaba; faltaba la puerta.
   *
   *  Y como el override ahora se decide ACÁ, sirve para cualquier hora que ella
   *  escriba, no sólo las HH:00 que prellenaba la grilla. */
  const [confirmarFueraDeHorario, setConfirmarFueraDeHorario] = useState<string | null>(null)
  /** Avisarle a la paciente que le agendamos. Default SÍ; el silencio pide motivo. */
  const [avisarAlCrear, setAvisarAlCrear] = useState(true)
  const [motivoSinAviso, setMotivoSinAviso] = useState('')
  const [virtualLink, setVirtualLink] = useState('')
  const [desiredAt, setDesiredAt] = useState('')

  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  // Calcular si la fecha/hora está dentro de la ventana de anticipación mínima
  const advanceWarning = (() => {
    if (!date || !time || !minBookingAdvanceHours || minBookingAdvanceHours === 0) return null
    const selectedDateTime = new Date(`${date}T${time}:00-05:00`)
    const now = new Date()
    const minAllowed = new Date(now.getTime() + minBookingAdvanceHours * 60 * 60 * 1000)
    if (selectedDateTime < minAllowed) {
      const label = minBookingAdvanceHours >= 24
        ? `${Math.round(minBookingAdvanceHours / 24)} día(s)`
        : `${minBookingAdvanceHours} horas`
      return `La anticipación mínima para pacientes es ${label}. Esta cita es más próxima, pero como administrador puedes agendarla.`
    }
    return null
  })()

  const overlayRef = useRef<HTMLDivElement>(null)

  // Cargar datos iniciales si estamos editando
  useEffect(() => {
    if (initialData) {
      setPatientId(initialData.patient_id)
      setPatientName(initialData.patient_name)
      setDoctorId(initialData.doctor_id)
      setDate(initialData.date)
      setTime(initialData.time)
      setDurationMinutes(initialData.duration_minutes || 30)
      setReason(initialData.reason || '')
      setPaymentType(initialData.payment_type || 'Particular')
      setEpsName(initialData.eps_name || '')
      setDesiredAt(initialData.desired_at ?? '')
      // La modalidad NO se precargaba: al editar, el select mostraba siempre
      // "Presencial" aunque la cita fuera virtual, y guardar la cambiaba sin
      // que nadie lo hubiera pedido. Una pantalla que no muestra el dato que
      // dice editar miente en las dos direcciones.
      setModality(initialData.modality ?? 'presencial')
      setVirtualLink(initialData.virtual_link ?? '')
      setAvisarPaciente(true); setMotivoPaciente(''); setMotivoInterno(''); setConfirmarExtra(null); setConfirmarFueraDeHorario(null)
      setAvisarAlCrear(true); setMotivoSinAviso('')
      setServicioKey(''); setBusquedaServicio(''); setConvenioSel(''); setConvenioLibre('')
    } else {
      // Reset para creación nueva (con paciente pre-seleccionada si viene)
      setPatientId(prefillPatient?.id ?? '')
      setPatientName(prefillPatient?.name ?? '')
      setDoctorId(doctors.length === 1 ? doctors[0].id : '')
      setDate('')
      setTime('')
      setDurationMinutes(30)
      setReason('')
      setPaymentType('Particular')
      setEpsName('')
      setModality('presencial')
      setVirtualLink('')
      setDesiredAt('')
    }
    setError('')
    setFieldErrors({})
  }, [initialData, isOpen, doctors, prefillPatient])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Click fuera del modal para cerrar
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose]
  )

  function validate(): boolean {
    const errors: Record<string, string> = {}

    if (!patientId) errors.patient = 'Selecciona un paciente'
    if (!doctorId) errors.doctor = 'Selecciona un doctor'
    if (!date) errors.date = 'Selecciona una fecha'
    if (!time) errors.time = 'Selecciona una hora'
    if (durationMinutes < 5 || durationMinutes > 480) {
      errors.duration = 'La duración debe estar entre 5 y 480 minutos'
    }
    if (paymentType === 'EPS' && !epsName) {
      errors.eps = 'Selecciona la EPS'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Mismos campos que el server considera avisables. Si divergen, la pantalla
  // pediría un motivo que el server no exige (o al revés).
  const seMovioLaCita = Boolean(
    isEditing && initialData &&
    (date !== initialData.date || time !== initialData.time || doctorId !== initialData.doctor_id),
  )

  // ── SERVICIO → CONVENIO, en ese orden ───────────────────────────────
  //
  // El médico ya está elegido arriba, así que el catálogo se filtra por él: de
  // 33 nombres, Jorge tiene 11 y Juan Diego 17. Ofrecerle los 33 sería ofrecerle
  // servicios que ese médico no hace — lo mismo que el executor rechaza con
  // BLOCKED_BY_DOCTOR_PIN_SERVICE.
  const gruposDelMedico = consultationTypes && doctorId
    ? agruparPorMedico(consultationTypes, doctorId)
    : []
  const gruposVisibles = filtrarGrupos(gruposDelMedico, busquedaServicio)
  const grupoSel = gruposDelMedico.find((g) => g.key === servicioKey) ?? null
  const usaCatalogo = (consultationTypes?.length ?? 0) > 0

  /** La fila concreta: el grupo elegido + el convenio elegido. */
  const varianteSel: OpcionServicio | null =
    grupoSel && convenioSel && convenioSel !== CONVENIO_NO_LISTADO
      ? grupoSel.variantes.find((v) => v.id === convenioSel) ?? null
      : null

  /** Al cambiar de servicio: la duración sale del catálogo y el convenio se
   *  reinicia (los convenios son del servicio, no globales). */
  function elegirServicio(key: string) {
    setServicioKey(key)
    setConvenioSel(''); setConvenioLibre('')
    const g = gruposDelMedico.find((x) => x.key === key)
    if (g) {
      setDurationMinutes(g.durationMinutes)
      setReason(g.label)   // el motivo en texto sigue existiendo, ahora derivado
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!validate()) return

    // Construir starts_at con offset Colombia (-05:00)
    const startsAt = `${date}T${time}:00-05:00`

    const input: AppointmentInput = {
      patient_id: patientId,
      doctor_id: doctorId,
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      reason,
      // La fila del catálogo. Con "Otro convenio" no hay fila que corresponda,
      // así que se manda la PARTICULAR del mismo servicio: el precio real es
      // ése hasta que la clínica cargue el convenio.
      consultation_type_id: varianteSel?.id
        ?? (convenioSel === CONVENIO_NO_LISTADO
            ? (grupoSel?.variantes.find((v) => v.epsName === null)?.id ?? grupoSel?.variantes[0]?.id ?? null)
            : null),
      convenio_no_listado: convenioSel === CONVENIO_NO_LISTADO ? convenioLibre.trim() || null : null,
      payment_type: paymentType,
      eps_name: paymentType === 'EPS' ? epsName : '',
      modality,
      virtual_link: modality === 'virtual' ? virtualLink.trim() || null : null,
      desired_at: desiredAt || null,
      // De la grilla (clic en celda cerrada) O de la confirmación de acá.
      fuera_de_horario_confirmado: (fueraDeHorarioConfirmado ?? false) || confirmarFueraDeHorario !== null,
      // Sólo va en true después de que la secretaria vio contra quién agenda.
      extra_confirmado: confirmarExtra !== null,
      // Sólo aplica al CREAR: al editar, el aviso lo decide `avisarPaciente`.
      notificar_paciente: avisarAlCrear,
      motivo_sin_aviso: motivoSinAviso,
      motivo_para_paciente: motivoPaciente.trim() || null,
    }

    startTransition(async () => {
      const result = isEditing
        ? await updateAppointmentFromDashboard(initialData!.id, input, {
            notificar: seMovioLaCita ? avisarPaciente : true,
            motivoInterno,
            motivoParaPaciente: motivoPaciente.trim() || null,
          })
        : await createAppointment(input)

      if (!result.ok) {
        // Cupo ocupado: no es un error, es una pregunta. El server manda el
        // nombre de quien está en ese horario para que la secretaria decida
        // viendo contra qué agenda.
        if (result.error?.startsWith('CUPO_OCUPADO:')) {
          setConfirmarExtra(result.error.replace(/^CUPO_OCUPADO:\s*/, ''))
          setError('')
          return
        }
        // Fuera de horario: tampoco es un error, es una pregunta. El motivo ya
        // trae la franja real del médico ("atiende 07:30–11:00"), así que ella
        // decide con el dato delante. Mismo flujo que CUPO_OCUPADO.
        if (result.error?.startsWith('FUERA_DE_HORARIO:')) {
          setConfirmarFueraDeHorario(result.error.replace(/^FUERA_DE_HORARIO:\s*/, ''))
          setError('')
          return
        }
        setError(result.error ?? 'Error guardando la cita')
        return
      }

      const aviso = (result as { warning?: string }).warning
      if (aviso) window.alert(aviso)
      onSaved()
      onClose()
    })
  }

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="card-v2 w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 p-6">
        {/* Encabezado */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Editar cita' : 'Nueva cita'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Error general */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Fuera de la franja del médico. Tampoco es un error: la clínica
            atiende extras a horas que no están cargadas —Jorge tiene 19 citas
            de iSalud antes de las 07:30— y el horario en pantalla puede estar
            desactualizado. El motivo ya trae la franja real, así que ella
            decide viendo el dato, no adivinando. */}
        {confirmarFueraDeHorario && (
          <div
            style={{
              marginBottom: '16px', padding: '14px', borderRadius: 'var(--v2-radius)',
              background: 'var(--v2-amber-soft)', border: '1px solid rgba(255,184,69,0.45)',
            }}
          >
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#b07d00', marginBottom: '4px' }}>
              Fuera del horario del médico
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text)', lineHeight: 1.45 }}>{confirmarFueraDeHorario}</p>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '6px' }}>
              Si el médico lo autorizó, puedes agendarla igual. Queda registrado quién la confirmó.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setConfirmarFueraDeHorario(null)}
                className="btn-v2-secondary"
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                Cambiar el horario
              </button>
              <button
                type="submit"
                form="form-cita"
                disabled={isPending}
                style={{
                  fontSize: '12px', fontWeight: 700, padding: '8px 16px',
                  borderRadius: 'var(--v2-radius)', border: 'none', cursor: 'pointer',
                  background: '#b07d00', color: '#fff',
                  fontFamily: 'var(--font-manrope), sans-serif',
                }}
              >
                {isPending ? 'Agendando...' : 'Agendar fuera de horario'}
              </button>
            </div>
          </div>
        )}

        {/* Cupo ocupado. NO es un error: es una decisión que sólo puede tomar
            una persona —el extra existe porque el médico lo autorizó ese día, y
            eso el sistema no lo puede saber—. Por eso se muestra CONTRA QUIÉN
            se está agendando antes de confirmar. */}
        {confirmarExtra && (
          <div
            style={{
              marginBottom: '16px', padding: '14px', borderRadius: 'var(--v2-radius)',
              background: 'var(--v2-amber-soft)', border: '1px solid rgba(255,184,69,0.45)',
            }}
          >
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#b07d00', marginBottom: '4px' }}>
              Ese cupo ya está ocupado
            </p>
            <p style={{ fontSize: '12px', color: 'var(--v2-text)', lineHeight: 1.45 }}>{confirmarExtra}</p>
            <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '6px' }}>
              Se va a guardar como <strong>Extra</strong>. Las dos citas quedan en la agenda y el
              asistente virtual sigue viendo el horario como ocupado.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setConfirmarExtra(null)}
                className="btn-v2-secondary"
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                Cambiar el horario
              </button>
              <button
                type="submit"
                form="form-cita"
                disabled={isPending}
                style={{
                  fontSize: '12px', fontWeight: 700, padding: '8px 16px',
                  borderRadius: 'var(--v2-radius)', border: 'none', cursor: 'pointer',
                  background: '#b07d00', color: '#fff',
                  fontFamily: 'var(--font-manrope), sans-serif',
                }}
              >
                {isPending ? 'Agendando...' : 'Agendar como extra'}
              </button>
            </div>
          </div>
        )}

        <form id="form-cita" onSubmit={handleSubmit} className="space-y-4">
          {/* Paciente */}
          <div>
            <label className="label">Paciente</label>
            <PatientSearch
              value={patientId}
              onChange={(id, name) => {
                setPatientId(id)
                setPatientName(name)
                if (id) setFieldErrors((prev) => ({ ...prev, patient: '' }))
              }}
              placeholder="Buscar paciente por nombre o teléfono..."
            />
            {fieldErrors.patient && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.patient}</p>
            )}
          </div>

          {/* Doctor */}
          <div>
            <label className="label">Doctor</label>
            <select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                if (e.target.value) setFieldErrors((prev) => ({ ...prev, doctor: '' }))
              }}
              className="input-v2 w-full"
            >
              <option value="">Seleccionar doctor...</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </select>
            {fieldErrors.doctor && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.doctor}</p>
            )}
          </div>

          {/* Fecha y Hora en fila */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, date: '' }))
                }}
                className="input-v2 w-full"
              />
              {fieldErrors.date && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.date}</p>
              )}
            </div>
            <div>
              <label className="label">Hora</label>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, time: '' }))
                }}
                className="input-v2 w-full"
              />
              {fieldErrors.time && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.time}</p>
              )}
            </div>
          </div>

          {/* Warning anticipación mínima */}
          {advanceWarning && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              {advanceWarning}
            </div>
          )}

          {/* Fecha deseada por el paciente (opcional) */}
          <div>
            <label className="label">
              Fecha deseada por paciente
              <span className="text-slate-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="date"
              className="input-v2 w-full"
              value={desiredAt}
              onChange={(e) => setDesiredAt(e.target.value)}
              style={{ fontSize: '12px' }}
            />
            <p className="text-xs text-slate-400 mt-1">
              Si difiere de la fecha asignada (e.g. paciente quería viernes pero solo había lunes).
            </p>
          </div>

          {/* Duración */}
          <div>
            <label className="label">Duración (minutos)</label>
            <input
              type="number"
              min={5}
              max={480}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="input-v2 w-24"
            />
            {fieldErrors.duration && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.duration}</p>
            )}
          </div>

          {/* Motivo */}
          <div>
            {/* SERVICIO — desplegable con buscador, filtrado por médico.
                Reemplaza al Motivo en texto libre: la cita necesita
                consultation_type_id para tener precio, duración y reglas, igual
                que una del agente (invariante 5). Antes el panel guardaba texto
                y las 10 citas que creó quedaron sin tipo. */}
            {usaCatalogo ? (
              <>
                <label className="label">Servicio</label>
                {!doctorId ? (
                  <p style={{ fontSize: '12px', color: 'var(--v2-text-subtle)', padding: '8px 0' }}>
                    Elige primero el médico.
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      value={busquedaServicio}
                      onChange={(e) => setBusquedaServicio(e.target.value)}
                      placeholder="🔍 Escribe para buscar entre los servicios…"
                      className="input-v2 w-full"
                      style={{ marginBottom: '6px' }}
                    />
                    <select
                      value={servicioKey}
                      onChange={(e) => elegirServicio(e.target.value)}
                      className="input-v2 w-full"
                      size={gruposVisibles.length > 6 ? 7 : undefined}
                    >
                      <option value="">— Elige el servicio —</option>
                      {gruposVisibles.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.label} · {g.durationMinutes} min · {rangoDePrecios(g)}
                        </option>
                      ))}
                    </select>
                    {busquedaServicio && gruposVisibles.length === 0 && (
                      <p style={{ fontSize: '12px', color: 'var(--v2-red)', marginTop: '4px' }}>
                        Ese médico no tiene ningún servicio que coincida con &quot;{busquedaServicio}&quot;.
                      </p>
                    )}
                  </>
                )}

                {/* CONVENIO — sale de las variantes del servicio ELEGIDO, no de
                    una lista global: un convenio que no tiene ese servicio no
                    puede ofrecerse. La opción "Otro" es la salida honesta para
                    lo que la clínica todavía no cargó. */}
                {grupoSel && (
                  <div style={{ marginTop: '10px' }}>
                    <label className="label">Quién paga</label>
                    <select
                      value={convenioSel}
                      onChange={(e) => setConvenioSel(e.target.value)}
                      className="input-v2 w-full"
                    >
                      <option value="">— Elige —</option>
                      {grupoSel.variantes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.epsLabel ?? 'Particular'} · {precioCorto(v.price)}
                        </option>
                      ))}
                      <option value={CONVENIO_NO_LISTADO}>Otro convenio (no listado)…</option>
                    </select>

                    {convenioSel === CONVENIO_NO_LISTADO && (
                      <div style={{ marginTop: '6px' }}>
                        <input
                          type="text"
                          value={convenioLibre}
                          onChange={(e) => setConvenioLibre(e.target.value)}
                          placeholder="Ej: Nueva EPS"
                          className="input-v2 w-full"
                        />
                        <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)', marginTop: '4px', lineHeight: 1.45 }}>
                          La clínica no tiene ese convenio cargado en este servicio, así que la cita
                          queda con el <strong>precio particular</strong>. Va a aparecer en{' '}
                          <strong>Conversaciones → Servicios</strong> para que lo carguen.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="label">Motivo</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Consulta general, control, etc."
                  className="input-v2 w-full"
                />
              </>
            )}
          </div>

          {/* Aviso a la paciente — sólo cuando la cita se MUEVE.
              Una cita movida en silencio es peor que una cancelada con aviso:
              la paciente llega el día que ya no es. */}
          {seMovioLaCita && (
            <div style={{ padding: '14px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-amber-soft)', border: '1px solid rgba(255,184,69,0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>Avisarle a la paciente</p>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)' }}>
                    Cambiaste la fecha, la hora o el médico. Recibe la cita nueva y el archivo para su calendario, en un solo mensaje.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAvisarPaciente(!avisarPaciente)}
                  className="toggle-v2"
                  data-active={avisarPaciente ? 'true' : 'false'}
                />
              </div>

              {avisarPaciente ? (
                <div style={{ marginTop: '10px' }}>
                  <label className="label" style={{ fontSize: '11px' }}>Motivo para la paciente (opcional)</label>
                  <input
                    className="input-v2 w-full"
                    value={motivoPaciente}
                    onChange={(e) => setMotivoPaciente(e.target.value)}
                    placeholder="el doctor tuvo una urgencia"
                    style={{ fontSize: '12px' }}
                  />
                </div>
              ) : (
                <div style={{ marginTop: '10px' }}>
                  <label className="label" style={{ fontSize: '11px', color: 'var(--v2-red)' }}>
                    Motivo interno * — obligatorio para mover sin avisar
                  </label>
                  <input
                    className="input-v2 w-full"
                    value={motivoInterno}
                    onChange={(e) => setMotivoInterno(e.target.value)}
                    placeholder="la paciente ya lo sabe, lo coordinamos por teléfono"
                    style={{ fontSize: '12px' }}
                  />
                  <p style={{ fontSize: '10px', color: 'var(--v2-red)', marginTop: '4px' }}>
                    La paciente no se va a enterar del cambio por este medio.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Aviso a la paciente al AGENDAR. Sólo en cita nueva: al editar, el
              aviso lo maneja el bloque de "se movió la cita" de arriba.

              createAppointment no avisaba por NINGÚN camino: se escribió para
              cargar citas de gente que llamó por teléfono —donde el aviso ya
              ocurrió en la llamada— y quedó así para todos. El 19/08 dos
              pacientes quedaron agendadas para septiembre sin enterarse; una ni
              siquiera había escrito nunca por WhatsApp. */}
          {!isEditing && (
            <div style={{ padding: '14px', borderRadius: 'var(--v2-radius)', background: 'var(--v2-bg-soft)', border: '1px solid var(--v2-border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v2-text)' }}>Avisarle a la paciente</p>
                  <p style={{ fontSize: '11px', color: 'var(--v2-text-muted)' }}>
                    Recibe la cita por WhatsApp y el archivo para su calendario, en un solo mensaje.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAvisarAlCrear(!avisarAlCrear)}
                  className="toggle-v2"
                  data-active={avisarAlCrear ? 'true' : 'false'}
                />
              </div>

              {avisarAlCrear ? (
                <div style={{ marginTop: '10px' }}>
                  <label className="label" style={{ fontSize: '11px' }}>Algo más que quieras decirle (opcional)</label>
                  <input
                    className="input-v2 w-full"
                    value={motivoPaciente}
                    onChange={(e) => setMotivoPaciente(e.target.value)}
                    placeholder="el doctor pidió control en un mes"
                    style={{ fontSize: '12px' }}
                  />
                </div>
              ) : (
                <div style={{ marginTop: '10px' }}>
                  <label className="label" style={{ fontSize: '11px', color: 'var(--v2-red)' }}>
                    Motivo * — obligatorio para agendar sin avisar
                  </label>
                  <input
                    className="input-v2 w-full"
                    value={motivoSinAviso}
                    onChange={(e) => setMotivoSinAviso(e.target.value)}
                    placeholder="la paciente acaba de llamar y ya lo sabe"
                    style={{ fontSize: '12px' }}
                  />
                  <p style={{ fontSize: '10px', color: 'var(--v2-red)', marginTop: '4px' }}>
                    No va a recibir ningún mensaje. Se va a enterar recién con el recordatorio.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Modalidad */}
          <div>
            <label className="label">Modalidad</label>
            <select
              value={modality}
              onChange={(e) => setModality(e.target.value as AppointmentModality)}
              className="input-v2 w-full"
            >
              <option value="presencial">Presencial</option>
              <option value="virtual">Virtual (videollamada)</option>
            </select>
          </div>

          {/* Link virtual (condicional) */}
          {modality === 'virtual' && (
            <div>
              <label className="label">
                Link de videollamada
                <span className="text-slate-400 font-normal ml-1">(opcional)</span>
              </label>
              <input
                type="url"
                value={virtualLink}
                onChange={(e) => setVirtualLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="input-v2 w-full"
              />
              <p className="text-xs text-slate-400 mt-1">
                Si no se proporciona, se generará automáticamente según la configuración del consultorio.
              </p>
            </div>
          )}

          {/* Tipo de pago */}
          <div>
            <label className="label">Tipo de pago</label>
            <select
              value={paymentType}
              onChange={(e) => {
                const val = e.target.value as PaymentType
                setPaymentType(val)
                if (val !== 'EPS') setEpsName('')
              }}
              className="input-v2 w-full"
            >
              {PAYMENT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {pt}
                </option>
              ))}
            </select>
          </div>

          {/* EPS (condicional) */}
          {paymentType === 'EPS' && (
            <div>
              <label className="label">EPS</label>
              <select
                value={epsName}
                onChange={(e) => {
                  setEpsName(e.target.value)
                  if (e.target.value) setFieldErrors((prev) => ({ ...prev, eps: '' }))
                }}
                className="input-v2 w-full"
              >
                <option value="">Seleccionar EPS...</option>
                {EPS_OPTIONS.map((eps) => (
                  <option key={eps} value={eps}>
                    {eps}
                  </option>
                ))}
              </select>
              {fieldErrors.eps && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.eps}</p>
              )}
            </div>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="btn-v2-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-v2-primary"
            >
              {isPending
                ? 'Guardando...'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Agendar cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
