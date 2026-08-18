/**
 * Importa a `patients` los documentos de `isalud_clientes` que NO están en el
 * padrón, y re-enlaza las citas futuras por documento.
 *
 * REGLAS (no negociables, por eso están en código y no en la cabeza de nadie):
 *   - Match y dedup por DOCUMENTO exacto normalizado. NUNCA por nombre.
 *   - No se pisa ninguna ficha existente. Sólo se CREA lo que no está.
 *   - Teléfono sólo si pasa `esNumeroEnviable` — la MISMA función que usa el
 *     envío. Si no pasa, la ficha se crea sin teléfono; no se arregla ni se
 *     adivina.
 *   - proactive_contact_opt_in = true, igual que el resto del padrón de Algia.
 *   - NO se envía ningún mensaje. Los recordatorios salen solos en el cron.
 *
 * DRY_RUN=1 para ver los números sin escribir.
 * Run: TZ=America/Bogota npx tsx --env-file=.env.production.local scripts/importar-clientes-faltantes.ts
 */
import { supabaseAdmin } from '@/lib/supabase/admin'
import { esNumeroEnviable } from '@/lib/utils/whatsapp-url'
import { normalizePhone } from '@/lib/utils/dates'

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const DRY = process.env.DRY_RUN === '1'
const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

async function traerTodo<T>(tabla: string, cols: string): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseAdmin.from(tabla).select(cols)
      .eq('clinic_id', ALGIA).range(desde, desde + 999)
    if (error) throw new Error(`${tabla}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(DRY ? '── DRY RUN, no escribe ──\n' : '── EJECUTANDO ──\n')

  const clientes = await traerTodo<{ documento: string | null; nombre: string | null; telefono: string | null }>(
    'isalud_clientes', 'documento, nombre, telefono')
  const pacientes = await traerTodo<{ document_number: string | null; phone: string | null }>(
    'patients', 'document_number, phone')

  const yaEstan = new Set(pacientes.map((p) => soloDigitos(p.document_number)).filter(Boolean))
  // 🛑 `patients` tiene UNIQUE (clinic_id, phone). Dos cosas que eso impide:
  //   - más de UNA ficha sin teléfono, porque el "sin teléfono" del padrón es ''
  //     y '' colisiona consigo mismo;
  //   - una ficha nueva con un teléfono que ya usa otra (madre e hija, pareja).
  // Es, casi con seguridad, la razón por la que el import original dejó gente
  // afuera. No se toca el constraint ni se pisa la ficha existente: lo que
  // colisiona queda SIN CREAR y se reporta.
  const telesOcupados = new Set(pacientes.map((p) => (p.phone ?? '').trim()).filter((t) => t !== ''))
  const hayFichaSinTelefono = pacientes.some((p) => (p.phone ?? '').trim() === '')
  console.log(`isalud_clientes: ${clientes.length} · padrón con documento: ${yaEstan.size}`)

  // Dedup por documento DENTRO del origen también: si iSalud repite el mismo
  // documento, se crea UNA ficha, no dos.
  const faltantes = new Map<string, { nombre: string; telefono: string | null }>()
  let sinDocumento = 0
  for (const c of clientes) {
    const doc = soloDigitos(c.documento)
    if (!doc) { sinDocumento++; continue }
    if (yaEstan.has(doc)) continue
    if (!faltantes.has(doc)) faltantes.set(doc, { nombre: (c.nombre ?? '').trim(), telefono: c.telefono })
  }
  console.log(`documentos que faltan: ${faltantes.size}  (filas de origen sin documento: ${sinDocumento})\n`)

  const filas = [...faltantes.entries()].map(([doc, v]) => {
    const usable = esNumeroEnviable(v.telefono)
    return {
      clinic_id: ALGIA,
      name: v.nombre || `(sin nombre) ${doc}`,
      // phone es NOT NULL en el esquema: el "sin teléfono" del padrón es ''.
      phone: usable ? normalizePhone((v.telefono ?? '').trim()) : '',
      document_number: doc,
      document_type: null,          // iSalud no lo trae; no se inventa
      proactive_contact_opt_in: true,
      _tel_usable: usable,
      _tel_habia: !!(v.telefono ?? '').trim(),
    }
  })

  // ── Filtrado por el UNIQUE, ANTES de intentar el insert ──
  const creables: typeof filas = []
  const bloqueadas = { telefonoYaUsado: 0, sinTelefonoNoCabe: 0 }
  const vistosEnLote = new Set<string>()
  let usadoElHuecoSinTelefono = hayFichaSinTelefono

  for (const f of filas) {
    if (f.phone === '') {
      // Sólo puede existir UNA ficha con phone=''. Si ya hay (o ya usamos el
      // hueco en este mismo lote), esta no se puede crear.
      if (usadoElHuecoSinTelefono) { bloqueadas.sinTelefonoNoCabe++; continue }
      usadoElHuecoSinTelefono = true
      creables.push(f); continue
    }
    if (telesOcupados.has(f.phone) || vistosEnLote.has(f.phone)) { bloqueadas.telefonoYaUsado++; continue }
    vistosEnLote.add(f.phone)
    creables.push(f)
  }

  const conTel = filas.filter((f) => f._tel_usable).length
  const telInservible = filas.filter((f) => !f._tel_usable && f._tel_habia).length
  console.log(`documentos faltantes            : ${filas.length}`)
  console.log(`  con teléfono válido           : ${conTel}`)
  console.log(`  teléfono presente pero malo   : ${telInservible}`)
  console.log(`  sin teléfono en origen        : ${filas.length - conTel - telInservible}`)
  console.log(`\nbloqueadas por UNIQUE(clinic_id, phone):`)
  console.log(`  teléfono ya usado por otra ficha: ${bloqueadas.telefonoYaUsado}`)
  console.log(`  sin teléfono y el hueco '' ocupado: ${bloqueadas.sinTelefonoNoCabe}`)
  console.log(`\nCREABLES: ${creables.length}  (con teléfono: ${creables.filter((f) => f._tel_usable).length})\n`)

  if (DRY) { console.log('DRY RUN — nada escrito.'); return }

  let creadas = 0
  for (let i = 0; i < creables.length; i += 200) {
    const lote = creables.slice(i, i + 200).map(({ _tel_usable, _tel_habia, ...f }) => f)
    const { data, error } = await supabaseAdmin.from('patients').insert(lote).select('id')
    if (error) { console.error(`  ❌ lote ${i}: ${error.message}`); continue }
    creadas += data?.length ?? 0
    process.stdout.write(`\r  creadas: ${creadas}/${creables.length}`)
  }
  console.log(`\n\n✅ fichas creadas: ${creadas}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
