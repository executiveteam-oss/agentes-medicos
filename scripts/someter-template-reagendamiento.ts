/**
 * Somete `reagendamiento_cita` a Meta para su aprobación.
 *
 * Meta tarda desde minutos hasta 24-48h en revisar, y eso no depende de
 * nosotros: por eso se somete apenas se define el wording, aunque el código
 * siga usando `contacto_general` mientras tanto.
 *
 * Sin --submit sólo IMPRIME el payload. Nada se manda hasta que se lo pidan.
 *
 * ⚠️ Imports dinámicos a propósito: los estáticos se hoistean por encima de
 * loadEnvFile().
 *
 * Run: TZ=America/Bogota npx tsx scripts/someter-template-reagendamiento.ts [--submit]
 */
if (process.env.NODE_ENV !== 'development') {
  ;(process.env as Record<string, string>).NODE_ENV = 'development'
}
import { existsSync, readFileSync } from 'fs'
function loadEnvFile(p: string): void {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvFile('.env.production.local')

const ALGIA = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
const API = 'https://graph.facebook.com/v21.0'

async function main() {
  const submit = process.argv.includes('--submit')
  const { createClient } = await import('@supabase/supabase-js')
  const { REAGENDA_TEMPLATE_NAME, REAGENDA_TEMPLATE_BODY, TEMPLATE_LANGUAGE } =
    await import('@/lib/whatsapp/appointment-templates')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: clinic } = await admin
    .from('clinics').select('name, whatsapp_phone_id, whatsapp_access_token').eq('id', ALGIA).single()
  if (!clinic?.whatsapp_phone_id || !clinic.whatsapp_access_token) {
    throw new Error('La clínica no tiene phone_id o token de WhatsApp')
  }
  const token = clinic.whatsapp_access_token as string

  // El WABA ID no está en la DB y este token NO lo expone: es un system user
  // token alcanzado al NÚMERO, no a la cuenta. Se probaron
  // `?fields=whatsapp_business_account` (v17/v19/v21), debug_token,
  // assigned_whatsapp_business_accounts y el app token — ninguno lo devuelve.
  //
  // Se saca a mano de Meta Business Manager → Cuentas de WhatsApp → ID, y se
  // pasa por env. Vale para todas las clínicas del mismo Business.
  const wabaId = process.env.WHATSAPP_WABA_ID
  if (!wabaId) {
    console.error('Falta WHATSAPP_WABA_ID. Sacalo de Meta Business Manager → Cuentas de WhatsApp.')
    console.error('Ej: WHATSAPP_WABA_ID=123456789 npx tsx scripts/someter-template-reagendamiento.ts --submit')
    process.exit(1)
  }
  console.log(`clínica     : ${clinic.name}`)
  console.log(`WABA ID     : ${wabaId}`)

  // Validar el WABA con una LECTURA antes de mostrar nada. El dry-run no
  // llamaba a Meta, así que un ID equivocado se descubría recién al someter.
  const rCheck = await fetch(`${API}/${wabaId}/message_templates?limit=200&fields=name,status,language`,
    { headers: { Authorization: `Bearer ${token}` } })
  const jCheck = await rCheck.json()
  if (!rCheck.ok) {
    console.error(`\n❌ El WABA ID no responde (HTTP ${rCheck.status}):`, JSON.stringify(jCheck))
    process.exit(1)
  }
  const existentes = (jCheck.data ?? []) as { name: string; status: string; language: string }[]
  console.log(`✅ WABA válido — ${existentes.length} plantillas en la cuenta`)
  for (const t of existentes) console.log(`   · ${t.name} [${t.language}] ${t.status}`)
  const yaEsta = existentes.find((t) => t.name === REAGENDA_TEMPLATE_NAME && t.language === TEMPLATE_LANGUAGE)
  if (yaEsta) {
    console.log(`\n⚠️  Ya existe con estado ${yaEsta.status}. Someterla de nuevo la RECHAZA por duplicada.`)
    if (submit) process.exit(1)
  }

  const payload = {
    name: REAGENDA_TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: 'UTILITY',   // avisa de un cambio en un servicio ya contratado
    components: [
      {
        type: 'BODY',
        text: REAGENDA_TEMPLATE_BODY,
        example: {
          body_text: [[
            'María', 'ALGIA', 'la Dra. Daniela Osorio',
            'viernes 21 de agosto', '3:00 PM',
            'Motivo: el doctor tuvo una urgencia. Como cambió la fecha, necesitamos que la vuelvas a confirmar.',
            // omuwan.co — el dominio del proyecto. El .com NO es nuestro (responde 403),
            // y el ejemplo de una plantilla es lo que un revisor de Meta abre.
            'https://omuwan.co/cita/abc123',
          ]],
        },
      },
    ],
  }

  console.log('\n═══ Payload ═══')
  console.log(JSON.stringify(payload, null, 2))
  console.log('\n═══ Cómo lo va a leer la paciente ═══')
  const ejemplo = payload.components[0].example.body_text[0]
  console.log(REAGENDA_TEMPLATE_BODY.replace(/\{\{(\d)\}\}/g, (_, i) => ejemplo[Number(i) - 1]))

  if (!submit) {
    console.log('\n(dry-run — nada se envió. Correr con --submit para someterla.)')
    return
  }

  const r = await fetch(`${API}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const j = await r.json()
  console.log(`\n═══ Respuesta de Meta (HTTP ${r.status}) ═══`)
  console.log(JSON.stringify(j, null, 2))
  if (!r.ok) process.exit(1)
  console.log(`\n✅ Sometida. Estado: ${j.status ?? 'PENDING'} — Meta la revisa por su cuenta.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
