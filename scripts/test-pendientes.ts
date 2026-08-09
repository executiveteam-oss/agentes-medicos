// Tests de lib/conversations/pendientes — la fuente única de qué está esperando
// una conversación y con qué reloj se ordena en la cola.
import { pendientesDe, pendienteMasViejo, tienePendientes } from '../src/lib/conversations/pendientes'

let pass = 0, fail = 0
const t = (l: string, ok: boolean) => { ok ? (pass++, console.log(`  ✅ ${l}`)) : (fail++, console.log(`  ❌ ${l}`)) }

console.log('\nSIN PENDIENTES')
t('context vacío', pendientesDe({}).length === 0)
t('context null', pendientesDe(null).length === 0)
t('servicios sin timestamp NO cuenta', pendientesDe({ servicios_marcados: ['mapeo'] }).length === 0)

console.log('\nCADA TIPO')
t('servicio ruleado', pendientesDe({ servicios_marcados: ['mapeo'], servicios_marcados_at: '2026-08-09T10:00:00Z' })[0].tipo === 'servicio')
t('orden médica', pendientesDe({ orden_medica_pedida_at: '2026-08-09T10:00:00Z' })[0].tipo === 'orden_medica')
t('contacto general', pendientesDe({ contacto_enviado_at: '2026-08-09T10:00:00Z' })[0].tipo === 'contacto')

console.log('\nEL RELOJ DE LA COLA — manda el MÁS VIEJO')
const tres = {
  servicios_marcados: ['mapeo'], servicios_marcados_at: '2026-08-09T15:00:00Z',
  orden_medica_pedida_at: '2026-08-09T08:00:00Z',
  contacto_enviado_at: '2026-08-09T12:00:00Z',
}
t('devuelve los tres', pendientesDe(tres).length === 3)
t('el primero es el más viejo (orden médica, 8am)', pendientesDe(tres)[0].tipo === 'orden_medica')
t('pendienteMasViejo coincide', pendienteMasViejo(tres) === '2026-08-09T08:00:00Z')
t('tienePendientes', tienePendientes(tres) === true)

console.log('\nLA ETIQUETA DEL BADGE')
t('servicio usa nombre corto', pendientesDe({ servicios_marcados: ['mapeo'], servicios_marcados_at: 'x' })[0].etiqueta === '🚨 Mapeo')
t('dos servicios se juntan', pendientesDe({ servicios_marcados: ['mapeo','diu'], servicios_marcados_at: 'x' })[0].etiqueta === '🚨 Mapeo · DIU')
t('key desconocida no rompe', pendientesDe({ servicios_marcados: ['zzz'], servicios_marcados_at: 'x' })[0].etiqueta === '🚨 zzz')

console.log(`\n${pass} pass · ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
