// ============================================================
// MIGRACIÓN ALGIA (un solo uso). Importa TODOS los pacientes de iSalud a
// `patients`, idempotente por DOCUMENTO normalizado.
//   - contacto: documento, nombre, teléfono (de isalud_clientes)
//   - entidad + tratantes por especialidad (derivados de isalud_historico_rows)
//   - historial de asistencia desde `fase` (Facturado / Inasistente) + última cita
//   - opt_in=false, data_consent_at=null para TODOS
// Respeta fuentes humanas (entidad_source paciente/secretaria no se pisa; tratantes
// human no se pisan). Existentes por documento → UPDATE, nuevos → INSERT.
// Uso: TZ=America/Bogota npx tsx scripts/import-all-isalud-patients.ts [--apply]
// Sin --apply = DRY-RUN (no escribe, solo reporta).
// ============================================================
if (process.env.NODE_ENV !== 'development') { (process.env as Record<string,string>).NODE_ENV = 'development' }
import { existsSync, readFileSync } from 'fs'
function le(p:string){ if(!existsSync(p))return; for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

const APPLY = process.argv.includes('--apply')
const PHASE_A = process.argv.includes('--phase-a') // solo teléfono único y válido (sin migración)
const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const NOW = '2026-07-31T00:00:00Z' // fecha fija (Date.now no disponible en algunos entornos; acá sí, pero estable)
const norm = (s:string|null|undefined) => (s??'').replace(/\D/g,'')
function toE164Co(raw:string|null|undefined):string|null{ const d=norm(raw); if(d.length===10&&d.startsWith('3'))return '+57'+d; if(d.length===12&&d.startsWith('57'))return '+'+d; if(d.length===13&&d.startsWith('057'))return '+'+d.slice(1); return null }
function normName(s:string){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim() }

async function pageAll(supa:any, table:string, cols:string, extra?:(q:any)=>any){
  const out:any[]=[]; for(let from=0;;from+=1000){ let q=supa.from(table).select(cols).eq('clinic_id',ALGIA).range(from,from+999); if(extra)q=extra(q); const {data}=await q; if(!data||data.length===0)break; out.push(...data); if(data.length<1000)break } return out
}

async function main(){
  const { createClient } = await import('@supabase/supabase-js')
  const { deriveEntidad } = await import('../src/lib/isalud/entidad-tratante-derivation')
  const { deriveTratantesBySpecialty, mergeTratantesRespectingSource } = await import('../src/lib/isalud/tratante-specialty')
  const { insurerFromRecord } = await import('../src/lib/utils/insurer-from-record')
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('Cargando datos…')
  const clientes = await pageAll(supa, 'isalud_clientes', 'documento, nombre, telefono')
  const patients = await pageAll(supa, 'patients', 'id, document_number, phone, entidad, entidad_source, tratantes, name')
  const doctors  = await pageAll(supa, 'doctors', 'id, name, specialty, is_active')
  const mappings = await pageAll(supa, 'doctor_external_mappings', 'external_name, doctor_id', (q)=>q.eq('provider','isalud'))
  const histo    = await pageAll(supa, 'isalud_historico_rows', 'documento, aseguradora, profesional, servicio, procedimiento, fecha, inicio, isalud_agenda_id, fase')
  console.log(`clientes=${clientes.length} patients=${patients.length} doctors=${doctors.length} mappings=${mappings.length} histo=${histo.length}`)

  // Índices
  const patByDoc = new Map<string, any>()
  for(const p of patients){ const d=norm(p.document_number); if(d) patByDoc.set(d,p) }
  const docById = new Map<string, {id:string;specialty:string|null;is_active:boolean}>(doctors.map((d:any)=>[d.id,{id:d.id,specialty:d.specialty,is_active:d.is_active}]))
  // resolveDoctor: por mapping external_name, luego por nombre normalizado; solo ACTIVOS
  const mapByName = new Map<string,string>()
  for(const m of mappings){ if(m.external_name) mapByName.set(normName(m.external_name), m.doctor_id) }
  const docByName = new Map<string,string>()
  for(const d of doctors){ if(d.name) docByName.set(normName(d.name), d.id) }
  function resolveDoctor(profesional:string){ const key=normName(profesional); const id=mapByName.get(key)??docByName.get(key); if(!id)return null; const d=docById.get(id); if(!d||!d.is_active)return null; return {id:d.id, specialty:d.specialty} }

  // Histórico por documento
  const histoByDoc = new Map<string, any[]>()
  for(const r of histo){ const d=norm(r.documento); if(!d)continue; const a=histoByDoc.get(d)??[]; a.push(r); histoByDoc.set(d,a) }

  // Contadores
  let create=0, update=0
  let conEntidad=0, sinEntidadSinHisto=0, sinEntidadSoloParticular=0
  let conTratante=0, sinTratante=0
  let conUltimaCita=0, sinUltimaCita=0
  let conAsistencia=0, sinAsistencia=0
  let conTel=0, sinTel=0
  const phoneOwner = new Map<string,string>() // phone → primer documento (para colisión)
  let colisionTel=0

  const toWrite:any[]=[]

  for(const c of clientes){
    const doc = norm(c.documento); if(!doc) continue
    const existing = patByDoc.get(doc)
    if(existing) update++; else create++

    const rows = (histoByDoc.get(doc)??[]).map((r:any)=>({ aseguradora:r.aseguradora, profesional:r.profesional, servicio:r.servicio, procedimiento:r.procedimiento, fecha:r.fecha, inicio:r.inicio, isalud_agenda_id:Number(r.isalud_agenda_id)||0 }))
    const rawFases = (histoByDoc.get(doc)??[])

    // entidad (respeta fuente humana existente)
    let entidad:string|null = null
    const humanEntidad = existing && (existing.entidad_source==='paciente'||existing.entidad_source==='secretaria')
    if(humanEntidad){ entidad = existing.entidad }
    else { entidad = insurerFromRecord(deriveEntidad(rows)) }
    if(entidad) conEntidad++; else if(rows.length===0) sinEntidadSinHisto++; else sinEntidadSoloParticular++

    // tratantes (merge respetando humano)
    const derived = deriveTratantesBySpecialty(rows, resolveDoctor, NOW)
    const merged = mergeTratantesRespectingSource(existing?.tratantes ?? null, derived)
    if(Object.keys(merged).length>0) conTratante++; else sinTratante++

    // asistencia desde fase
    const facturadas = rawFases.filter((r:any)=>r.fase==='Facturado')
    const inasistente = rawFases.filter((r:any)=>r.fase==='Inasistente').length
    const totalHist = facturadas.length + inasistente
    const lastVisit = facturadas.map((r:any)=>r.fecha).filter(Boolean).sort().slice(-1)[0] ?? null
    if(lastVisit) conUltimaCita++; else sinUltimaCita++
    if(totalHist>0) conAsistencia++; else sinAsistencia++

    // teléfono + colisión
    const phone = toE164Co(c.telefono)
    if(phone){ conTel++; if(phoneOwner.has(phone)&&phoneOwner.get(phone)!==doc) colisionTel++; else phoneOwner.set(phone,doc) }
    else sinTel++

    toWrite.push({ doc, name: c.nombre || existing?.name || 'PACIENTE', phone, entidad, tratantes: merged, total_appointments: totalHist, no_show_count: inasistente, last_visit: lastVisit, isUpdate: !!existing, existingId: existing?.id })
  }

  // Ejemplos concretos para verificar en pantalla (nombre + entidad + tratante)
  const doctorNameById = new Map<string,string>(doctors.map((d:any)=>[d.id,d.name]))
  const ejemplos = toWrite.filter((w:any)=>w.entidad && Object.keys(w.tratantes).length>0).slice(0,3)
  if(ejemplos.length){
    console.log('\nEjemplos para buscar en /dashboard/patients después del import:')
    for(const e of ejemplos){
      const trats = Object.values(e.tratantes).map((t:any)=>doctorNameById.get(t.doctor_id)).filter(Boolean).join(', ')
      console.log(`  • "${e.name}"  → entidad: ${e.entidad}  · tratante: ${trats}  · ${e.total_appointments} citas, última ${e.last_visit ?? '—'}`)
    }
  }

  // ---- Corte de tratante por RECENCIA (última cita) ----
  const MO12 = '2025-07-31', YR2 = '2024-07-31'
  const recent = toWrite.filter((w:any)=>w.last_visit && w.last_visit >= MO12)
  const old2y  = toWrite.filter((w:any)=>w.last_visit && w.last_visit < YR2)
  const hasTrat = (w:any)=>Object.keys(w.tratantes).length>0
  const pct = (a:number,b:number)=> b===0?'—':`${(100*a/b).toFixed(1)}%`
  const recentT = recent.filter(hasTrat).length
  const old2yT = old2y.filter(hasTrat).length
  console.log(`\n=== Tratante por RECENCIA (no global) ===`)
  console.log(`  última cita <= 12 meses: ${recent.length} pacientes → con tratante ${recentT} (${pct(recentT,recent.length)})`)
  console.log(`  última cita > 2 años:    ${old2y.length} pacientes → con tratante ${old2yT} (${pct(old2yT,old2y.length)})`)

  // ---- FASE A: teléfono único y válido (no colisiona bajo la constraint actual) ----
  const phoneToDocs = new Map<string, Set<string>>()
  const addPh = (ph:string|null, d:string)=>{ if(!ph)return; const s=phoneToDocs.get(ph)??new Set<string>(); s.add(d); phoneToDocs.set(ph,s) }
  for(const w of toWrite){ if(!w.isUpdate) addPh(w.phone, w.doc) }        // nuevos: usan el tel del cliente
  for(const p of patients){ addPh(toE164Co(p.phone), norm(p.document_number)) } // existentes ocupan su tel
  const isUniquePhone = (ph:string|null)=> !!ph && (phoneToDocs.get(ph)?.size ?? 0) === 1
  // Fase A = updates (no tocan teléfono) + creates con teléfono único
  const phaseA = toWrite.filter((w:any)=> w.isUpdate || isUniquePhone(w.phone))
  const paCreate = phaseA.filter((w:any)=>!w.isUpdate).length
  const paUpdate = phaseA.filter((w:any)=>w.isUpdate).length
  const paEnt = phaseA.filter((w:any)=>w.entidad).length
  const paTra = phaseA.filter(hasTrat).length
  const paLast = phaseA.filter((w:any)=>w.last_visit).length
  const paAsis = phaseA.filter((w:any)=>w.total_appointments>0).length
  console.log(`\n=== FASE A — teléfono único y válido (importable SIN migración) ===`)
  console.log(`  TOTAL Fase A: ${phaseA.length}  (crear ${paCreate} + actualizar ${paUpdate})`)
  console.log(`  con entidad: ${paEnt}   con tratante: ${paTra}   con última cita: ${paLast}   con hist. asistencia: ${paAsis}`)
  console.log(`  EXCLUIDOS de Fase A → Fase B (post-migración): ${clientes.length - phaseA.length}  (448 teléfono compartido + 759 sin teléfono válido, menos updates)`)

  console.log(`\n=== ${APPLY?'APPLY':'DRY-RUN'}${PHASE_A?' [FASE A]':''} — universo isalud_clientes: ${clientes.length} ===`)
  console.log(`Se CREARÍAN: ${create}   Se ACTUALIZARÍAN: ${update} (ya existen por documento)`)
  console.log(`\nDerivación (sobre los ${create+update} que se tocarían):`)
  console.log(`  con ENTIDAD:        ${conEntidad}   sin entidad: ${create+update-conEntidad}  (sin histórico: ${sinEntidadSinHisto}, histórico solo Particular/sin aseg: ${sinEntidadSoloParticular})`)
  console.log(`  con TRATANTE:       ${conTratante}   sin: ${sinTratante}  (sin consulta con médico ACTIVO en histórico)`)
  console.log(`  con ÚLTIMA CITA:    ${conUltimaCita}   sin: ${sinUltimaCita}  (sin fase 'Facturado')`)
  console.log(`  con HIST. ASISTENCIA:${conAsistencia}   sin: ${sinAsistencia}  (sin Facturado ni Inasistente)`)
  console.log(`\nContacto:`)
  console.log(`  con TELÉFONO válido: ${conTel}   sin teléfono válido: ${sinTel}  (fijo/malformado → phone NULL)`)
  console.log(`\nColisión (constraint UNIQUE actual):`)
  console.log(`  documentos que CHOCARÍAN por teléfono compartido: ${colisionTel}  → se resuelven al aplicar la migración (phone nullable, sin UNIQUE)`)

  if(!APPLY){ console.log('\nDRY-RUN. No se escribió nada. Agregá --apply para el import real.'); return }

  // ---- APPLY ----
  const writeSet = PHASE_A ? phaseA : toWrite
  console.log(`\nEscribiendo… (${writeSet.length} registros${PHASE_A?' — FASE A':''})`)
  let ins=0, upd=0, err=0, skipColision=0
  const usedPhone = new Set<string>()
  for(const w of writeSet){
    // evitar colisión dentro del batch (constraint puede seguir viva si no se migró)
    let phone = w.phone
    if(phone && usedPhone.has(phone)) phone = null // el segundo del mismo número entra sin teléfono si la constraint sigue
    if(phone) usedPhone.add(phone)
    const payload:any = { name: (w.name||'PACIENTE').trim(), phone, entidad: w.entidad, entidad_source: w.entidad && !w.isUpdate ? 'isalud' : undefined, tratantes: w.tratantes, total_appointments: w.total_appointments, no_show_count: w.no_show_count, proactive_contact_opt_in: false }
    if(w.isUpdate){
      const upObj:any = { tratantes: w.tratantes, total_appointments: w.total_appointments, no_show_count: w.no_show_count }
      if(w.entidad) upObj.entidad = w.entidad // no pisar con null; fuente humana ya respetada arriba
      const { error } = await supa.from('patients').update(upObj).eq('id', w.existingId)
      if(error){ err++; if(err<=5)console.log(`  UPD err ${w.doc.slice(-3)}: ${error.message}`) } else upd++
    } else {
      const { error } = await supa.from('patients').insert({ clinic_id: ALGIA, document_type:'CC', document_number: w.doc, ...payload })
      if(error){ if(error.code==='23505'){ skipColision++ } else { err++; if(err<=5)console.log(`  INS err ${w.doc.slice(-3)}: ${error.message}`) } } else ins++
    }
  }
  console.log(`INSERT: ${ins}  UPDATE: ${upd}  skip colisión (constraint viva): ${skipColision}  errores: ${err}`)
}
main().catch(e=>console.log('FATAL: '+(e?.message??e)))
