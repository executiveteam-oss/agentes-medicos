// ============================================================
// SALUD DE LA CONFIGURACIÓN — qué le falta a esta clínica para que el agente
// responda bien.
//
// NO es el checklist de activación (`getSetupProgress`). Ese contesta
// "¿terminaste de configurar?" con booleanos y desaparece a los 3 días de
// completarse. Este contesta otra pregunta, y es permanente:
// **"¿qué va a contestar mal el agente por culpa de un dato que falta?"**
//
// La diferencia importa porque una clínica puede tener el checklist completo
// —médicos ✅, servicios ✅, WhatsApp ✅— y aun así tener 14 servicios sin
// precio y 6 convenios que el agente no reconoce. Eso es exactamente lo que
// pasa hoy en producción.
//
// CADA HALLAZGO SALE DE UNA FALLA REAL, no de una idea de lo que estaría bueno
// revisar. Y cada uno dice qué le pasa a la PACIENTE, porque un número solo no
// mueve a nadie a arreglarlo.
//
// Sirve para cualquier clínica: recibe clinicId y no asume nada de su catálogo.
//
// ─────────────────────────────────────────────────────────────
// 🚨 REGLA DE ESTA PANTALLA: NO ACUSA A LA CLÍNICA DE ALGO QUE ES NUESTRO.
//
// Antes de listar un dato como "te falta configurar", hay que verificar que el
// agente REALMENTE no puede llegar a él — contra la misma función que usa el
// agente, no contra lo que uno supone que hace. Si el dato está y el agente no
// lo ve, eso es un bug NUESTRO y va a nuestra lista, no a la de ellos.
//
// Ya pasó, y es la razón de que la regla exista: los 6 convenios "sin asociar"
// de Algia incluían COLMÉDICA, que sí estaba cargado — el matcher del agente no
// normalizaba tildes en la comparación directa. Le íbamos a pedir a la clínica
// que arreglara nuestro bug. Se arregló el matcher y quedaron 5.
//
// Por eso `Hallazgo.verificadoContra` es OBLIGATORIO: no se puede agregar un
// chequeo sin decir qué función del lado del agente se miró para confirmar que
// el dato es de verdad inalcanzable. Si no hay una función que mirar, el
// chequeo no está listo para acusar a nadie.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin'
import { convenioCoincide } from '@/lib/rules/convenio-aliases'

export type Severidad = 'alta' | 'media'

export interface Hallazgo {
  clave: string
  titulo: string
  /** Cuántos elementos están en esta situación. 0 = está bien. */
  cuantos: number
  /** El total contra el que se compara, para que el número tenga escala. */
  deUnTotalDe: number
  /** Qué le pasa a la paciente. En segunda persona, tuteo. */
  queImplica: string
  /** Los primeros nombres concretos, para que se sepa por dónde empezar. */
  ejemplos: string[]
  /** Dónde se arregla. */
  href: string
  hrefLabel: string
  severidad: Severidad
  /** OBLIGATORIO — qué se miró del lado del agente para confirmar que el dato
   *  es realmente inalcanzable para él. Ver la regla del encabezado. */
  verificadoContra: string
}

export interface SaludDeConfiguracion {
  clinicId: string
  hallazgos: Hallazgo[]
  /** Cuántos hallazgos tienen algo que arreglar. */
  conProblemas: number
  generadoEn: string
}

const MAX_EJEMPLOS = 6

/** Los ejemplos van SIN repetir: el catálogo tiene servicios con el mismo
 *  nombre, y ver "CONSULTA ENTREGA DE RESULTADOS" tres veces seguidas se lee
 *  como una pantalla rota, además de gastar los seis lugares en un solo caso.
 *  El conteo de arriba sigue siendo el real — acá sólo se muestran nombres. */
function ejemplosUnicos(nombres: string[]): string[] {
  return [...new Set(nombres.map((n) => n.trim()).filter(Boolean))].slice(0, MAX_EJEMPLOS)
}

export async function analizarSaludDeConfiguracion(clinicId: string): Promise<SaludDeConfiguracion> {
  const [ctRes, docRes] = await Promise.all([
    supabaseAdmin
      .from('consultation_types')
      .select('id, name, display_name, price, doctor_id, eps_name, available_conventions, preparacion, bookable_via_whatsapp')
      .eq('clinic_id', clinicId)
      .eq('is_active', true),
    supabaseAdmin
      .from('doctors')
      .select('id, name, working_hours, agenda_closed')
      .eq('clinic_id', clinicId)
      .eq('is_active', true),
  ])

  type CT = {
    id: string; name: string; display_name: string | null; price: number | null
    doctor_id: string | null; eps_name: string | null; available_conventions: string[] | null
    preparacion: string | null
    bookable_via_whatsapp: boolean | null
  }
  type Doc = { id: string; name: string; working_hours: Record<string, { active?: boolean; blocks?: unknown[] }> | null; agenda_closed: boolean | null }

  const tipos = (ctRes.data ?? []) as CT[]
  const medicos = (docRes.data ?? []) as Doc[]
  const nombre = (c: CT) => (c.display_name?.trim() || c.name).trim()

  const hallazgos: Hallazgo[] = []

  // ── 1. Convenios que la clínica cargó y el agente no reconoce ──────
  //
  // El agente resuelve "¿atienden X?" con check_eps_convenio, que matchea SOLO
  // contra `eps_name`. Los convenios que quedaron en `available_conventions`
  // —que es donde los dejó la unificación de servicios del 2026-07-10— son
  // invisibles para él. Se usa convenioCoincide, la MISMA función del executor:
  // si acá se reimplantara el matcheo, esta pantalla empezaría a mentir en
  // cuanto alguien tocara el del agente.
  const cargados = new Set<string>()
  for (const c of tipos) for (const v of c.available_conventions ?? []) if (v?.trim()) cargados.add(v.trim())
  for (const c of tipos) if (c.eps_name?.trim()) cargados.add(c.eps_name.trim())

  const reconocibles = tipos.map((c) => c.eps_name?.trim()).filter((x): x is string => !!x)
  const huerfanos = [...cargados].filter((conv) => !reconocibles.some((r) => convenioCoincide(conv, r))).sort()

  hallazgos.push({
    clave: 'convenios_no_reconocidos',
    titulo: 'Convenios que el agente no reconoce',
    cuantos: huerfanos.length,
    deUnTotalDe: cargados.size,
    queImplica: huerfanos.length > 0
      ? `Tienes ${cargados.size} convenios cargados y el agente reconoce ${cargados.size - huerfanos.length}. Estos ${huerfanos.length} no están asociados a ningún servicio, así que si una paciente pregunta por ellos el agente no va a saber responder y va a pasar la conversación a una persona.`
      : `Los ${cargados.size} convenios que tienes cargados están asociados a algún servicio: el agente los reconoce.`,
    ejemplos: ejemplosUnicos(huerfanos),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'alta',
    verificadoContra: 'convenio-aliases.convenioCoincide — la MISMA función con la que check_eps_convenio decide si reconoce un convenio',
  })

  // ── 2. Servicios sin precio ───────────────────────────────────────
  const sinPrecio = tipos.filter((c) => c.price == null || Number(c.price) <= 0)
  hallazgos.push({
    clave: 'servicios_sin_precio',
    titulo: 'Servicios sin precio',
    cuantos: sinPrecio.length,
    deUnTotalDe: tipos.length,
    queImplica: sinPrecio.length > 0
      ? `Si una paciente pregunta "¿cuánto cuesta?" por uno de estos ${sinPrecio.length} servicios, el agente no tiene el valor y tiene que derivarla. "Cuánto cuesta" es de las preguntas más frecuentes.`
      : 'Todos los servicios activos tienen precio: el agente puede responder cuánto cuesta cada uno.',
    ejemplos: ejemplosUnicos(sinPrecio.map(nombre)),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'alta',
    verificadoContra: 'executor.getConsultationPrice — lee consultation_types.price y NO tiene fallback a clinics.consultation_price, así que sin ese campo no hay precio que dar',
  })

  // ── 3. Servicios sin preparación cargada ──────────────────────────
  //
  // El campo existe (`requires_preparation` + `preparation_instructions`) y en
  // producción está vacío en el 100% de los servicios. Eso no es neutro: el
  // agente igual contesta, y lo que contesta se lo inventa. Medido el
  // 2026-08-21: dio "vejiga llena, toma agua 1 hora antes" para una ecografía
  // transvaginal, sin una sola línea de preparación en la base.
  const sinPreparacion = tipos.filter((c) => !c.preparacion?.trim())
  hallazgos.push({
    clave: 'servicios_sin_preparacion',
    titulo: 'Servicios sin preparación cargada',
    cuantos: sinPreparacion.length,
    deUnTotalDe: tipos.length,
    queImplica: sinPreparacion.length > 0
      ? `Si una paciente pregunta "¿qué preparación lleva?" por uno de estos ${sinPreparacion.length}, el agente NO responde de memoria: le dice que la indicación se la confirma el consultorio y le pasa la conversación a una persona. Cargá la preparación de los exámenes que la necesitan y la contesta él.`
      : 'Los servicios que lo necesitan tienen su preparación cargada.',
    ejemplos: ejemplosUnicos(sinPreparacion.map(nombre)),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'alta',
    verificadoContra: 'consultation_types.preparacion es la única fuente; el prompt la inyecta textual y agent-guards.detectPreparacionInventada bloquea cualquier indicación no anclada en ella',
  })

  // ── 4. Médicos sin horario ────────────────────────────────────────
  const tieneHorario = (d: Doc) =>
    !!d.working_hours && Object.values(d.working_hours).some((v) => v?.active && (v.blocks?.length ?? 0) > 0)
  const sinHorario = medicos.filter((d) => !tieneHorario(d))
  hallazgos.push({
    clave: 'medicos_sin_horario',
    titulo: 'Médicos sin horario',
    cuantos: sinHorario.length,
    deUnTotalDe: medicos.length,
    queImplica: sinHorario.length > 0
      ? `El agente no puede ofrecer ni un solo horario con ${sinHorario.length === 1 ? 'este médico' : `estos ${sinHorario.length} médicos`}: para él no atienden ningún día. Toda paciente que los pida va a terminar con una persona.`
      : 'Todos los médicos activos tienen horario: el agente puede ofrecer sus cupos.',
    ejemplos: ejemplosUnicos(sinHorario.map((d) => d.name)),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'alta',
    verificadoContra: 'working-hours.normalizeWorkingDay — sin working_hours devuelve {active:false, blocks:[]}, no un horario por defecto, así que check_availability no encuentra ni un cupo',
  })

  // ── 5. Servicios sin médico asignado ──────────────────────────────
  const sinMedico = tipos.filter((c) => !c.doctor_id)
  hallazgos.push({
    clave: 'servicios_sin_medico',
    titulo: 'Servicios sin médico asignado',
    cuantos: sinMedico.length,
    deUnTotalDe: tipos.length,
    queImplica: sinMedico.length > 0
      ? `El agente puede nombrar ${sinMedico.length === 1 ? 'este servicio' : `estos ${sinMedico.length} servicios`} pero no puede agendarlos: no sabe con qué médico. La paciente llega hasta el final y ahí se traba.`
      : 'Todos los servicios activos tienen un médico asignado.',
    ejemplos: ejemplosUnicos(sinMedico.map(nombre)),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'alta',
    verificadoContra: 'agent-context.findActiveConsultationTypes SÍ se lo pasa al agente, pero create_appointment necesita un doctor_id: puede nombrarlo y no puede agendarlo',
  })

  // ── 6. Agendas cerradas (informativo) ─────────────────────────────
  const cerradas = medicos.filter((d) => d.agenda_closed)
  hallazgos.push({
    clave: 'agendas_cerradas',
    titulo: 'Médicos con la agenda cerrada',
    cuantos: cerradas.length,
    deUnTotalDe: medicos.length,
    queImplica: cerradas.length > 0
      ? `El agente no agenda con ${cerradas.length === 1 ? 'este médico' : 'estos médicos'} mientras la agenda esté cerrada. Si fue a propósito, está bien; si quedó cerrada de un cierre viejo, estás perdiendo citas.`
      : 'Ninguna agenda está cerrada.',
    ejemplos: ejemplosUnicos(cerradas.map((d) => d.name)),
    href: '/dashboard/doctors',
    hrefLabel: 'Médicos y servicios',
    severidad: 'media',
    verificadoContra: 'doctors.agenda_closed lo respeta el executor al validar la escritura (puedeEscribirseLaCita → traerDisponibilidadDia)',
  })

  return {
    clinicId,
    hallazgos,
    conProblemas: hallazgos.filter((h) => h.cuantos > 0).length,
    generadoEn: new Date().toISOString(),
  }
}
