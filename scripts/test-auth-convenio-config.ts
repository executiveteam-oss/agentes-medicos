/**
 * Tests del schema Zod de AuthConvenioConfig + normalizer + matcher.
 *
 * Cubre especialmente las variantes ortográficas del staging Algia
 * (ver CLAUDE.md sección "variantes de nombre de convenio").
 *
 * Run: TZ=America/Bogota npx tsx scripts/test-auth-convenio-config.ts
 */

import {
  AuthConvenioConfigSchema,
  normalizeConvenioName,
  convenioRequiresAuthorization,
  fillMessagePlaceholders,
} from '../src/lib/rules/auth-convenio-config'

let passed = 0
let failed = 0
function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✅ ${label}`); passed++ }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++ }
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tests AuthConvenioConfig + normalizer + matcher')
  console.log('═══════════════════════════════════════════════════════════════')

  console.log('\n=== Schema válido: caso Algia ===')
  {
    const r = AuthConvenioConfigSchema.safeParse({
      convenios_que_requieren: ['SOS', 'MEDPLUS', 'COLMÉDICA', 'AXA COLPATRIA'],
      message_pedir_archivo: 'Para {servicio} con {convenio} necesito que me envíes la autorización direccionada a Algia.',
      match_mode: 'normalized_name',
    })
    assert('Acepta config completa Algia', r.success)
  }

  console.log('\n=== Schema válido: sin match_mode (default) ===')
  {
    const r = AuthConvenioConfigSchema.safeParse({
      convenios_que_requieren: ['SOS'],
      message_pedir_archivo: 'Para {servicio} con {convenio} necesito autorización.',
    })
    assert('match_mode default = normalized_name',
      r.success && r.data.match_mode === 'normalized_name')
  }

  console.log('\n=== Schema inválido: lista vacía ===')
  {
    const r = AuthConvenioConfigSchema.safeParse({
      convenios_que_requieren: [],
      message_pedir_archivo: 'Para {servicio} con {convenio} necesito autorización direccionada.',
    })
    assert('Rechaza lista vacía', !r.success)
  }

  console.log('\n=== Schema inválido: mensaje muy corto ===')
  {
    const r = AuthConvenioConfigSchema.safeParse({
      convenios_que_requieren: ['SOS'],
      message_pedir_archivo: 'corto',
    })
    assert('Rechaza mensaje < 20 chars', !r.success)
  }

  console.log('\n=== normalizeConvenioName: variantes de Colmédica ===')
  const colmedicaCanonical = normalizeConvenioName('COLMÉDICA')
  assert('"COLMÉDICA" produce normalización no vacía', colmedicaCanonical.length > 0)
  assert('"COLMEDICA MEDICINA PREPAGADA S.A." → mismo que "COLMÉDICA"',
    normalizeConvenioName('COLMEDICA MEDICINA PREPAGADA S.A.') === colmedicaCanonical,
    `obtuve "${normalizeConvenioName('COLMEDICA MEDICINA PREPAGADA S.A.')}" vs "${colmedicaCanonical}"`)
  assert('"COLMEDICA MEDICINA PREPAGADA SA" → mismo',
    normalizeConvenioName('COLMEDICA MEDICINA PREPAGADA SA') === colmedicaCanonical)
  assert('"COLMEDICA  MEDICINA  PREPAGADA  S.A." (doble espacio) → mismo',
    normalizeConvenioName('COLMEDICA  MEDICINA  PREPAGADA  S.A.') === colmedicaCanonical)
  assert('"Colmedica SA." → mismo',
    normalizeConvenioName('Colmedica SA.') === colmedicaCanonical)

  console.log('\n=== normalizeConvenioName: variantes de Allianz ===')
  const allianzCanonical = normalizeConvenioName('ALLIANZ')
  assert('"ALLIANZ SEGUROS DE VIDA S.A." → mismo que "ALLIANZ"',
    normalizeConvenioName('ALLIANZ SEGUROS DE VIDA S.A.') === allianzCanonical,
    `obtuve "${normalizeConvenioName('ALLIANZ SEGUROS DE VIDA S.A.')}" vs "${allianzCanonical}"`)
  assert('"ALLIANZ  SEGUROS DE VIDA S.A" (doble espacio) → mismo',
    normalizeConvenioName('ALLIANZ  SEGUROS DE VIDA S.A') === allianzCanonical)

  console.log('\n=== normalizeConvenioName: Coomeva variantes ===')
  const coomevaCanonical = normalizeConvenioName('COOMEVA')
  assert('"COOMEVA MEDICINA PREPAGADA SA" → mismo',
    normalizeConvenioName('COOMEVA MEDICINA PREPAGADA SA') === coomevaCanonical)
  assert('"COOMEVA MEDICINA PREPAGADA S.A" → mismo',
    normalizeConvenioName('COOMEVA MEDICINA PREPAGADA S.A') === coomevaCanonical)

  console.log('\n=== convenioRequiresAuthorization: matching positivo ===')
  const algiaList = ['SOS', 'MEDPLUS', 'COLMÉDICA', 'AXA COLPATRIA']
  assert('Paciente dice "tengo SOS" → matchea SOS',
    convenioRequiresAuthorization('SOS', algiaList))
  assert('Paciente "Colmédica" → matchea COLMÉDICA',
    convenioRequiresAuthorization('Colmédica', algiaList))
  assert('Paciente "COLMEDICA MEDICINA PREPAGADA S.A." → matchea COLMÉDICA',
    convenioRequiresAuthorization('COLMEDICA MEDICINA PREPAGADA S.A.', algiaList))
  assert('Paciente "AXA" (acortado) → matchea AXA COLPATRIA (substring)',
    convenioRequiresAuthorization('AXA', algiaList))
  assert('Paciente "Medplus" → matchea MEDPLUS',
    convenioRequiresAuthorization('Medplus', algiaList))
  // Nota: "MediPlus" con "i" extra NO matchea automáticamente — es typo
  // del sitio oficial (es "MedPlus" sin i). Si Lady detecta que pacientes
  // lo escriben con i, agrega "MEDIPLUS" a la lista.
  assert('Paciente "MediPlus" (typo con i extra) → NO matchea automático',
    !convenioRequiresAuthorization('MediPlus', algiaList))

  console.log('\n=== convenioRequiresAuthorization: matching negativo ===')
  assert('Paciente "Sura" → NO matchea (no está en lista Algia)',
    !convenioRequiresAuthorization('Sura', algiaList))
  assert('Paciente "Allianz" → NO matchea',
    !convenioRequiresAuthorization('Allianz', algiaList))
  assert('Paciente "Coomeva" → NO matchea',
    !convenioRequiresAuthorization('Coomeva', algiaList))
  assert('Paciente "Nueva EPS" → NO matchea',
    !convenioRequiresAuthorization('Nueva EPS', algiaList))
  assert('Empty string → NO matchea',
    !convenioRequiresAuthorization('', algiaList))
  assert('Empty list → NO matchea',
    !convenioRequiresAuthorization('SOS', []))

  console.log('\n=== convenioRequiresAuthorization: edge case "SOS" vs "S.O.S." ===')
  assert('"S.O.S." (con puntos) → matchea SOS',
    convenioRequiresAuthorization('S.O.S.', ['SOS']),
    `normalize("S.O.S.") = "${normalizeConvenioName('S.O.S.')}"`)

  console.log('\n=== fillMessagePlaceholders ===')
  {
    const r = fillMessagePlaceholders(
      'Para {servicio} con {convenio} necesito autorización.',
      { servicio: 'Colposcopia', convenio: 'SOS' },
    )
    assert('Reemplaza {servicio} y {convenio}',
      r === 'Para Colposcopia con SOS necesito autorización.')
  }
  {
    const r = fillMessagePlaceholders(
      'Para {servicio} con {convenio} en {servicio} necesito.',
      { servicio: 'Mapeo', convenio: 'AXA' },
    )
    assert('Reemplaza múltiples ocurrencias de {servicio}',
      r === 'Para Mapeo con AXA en Mapeo necesito.')
  }

  console.log(`\nResultado: ${passed} ✅ / ${failed} ❌`)
  if (failed > 0) process.exit(1)
}

main()
