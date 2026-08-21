import { existsSync, readFileSync } from 'fs'
function le(p:string){if(!existsSync(p))return;for(const l of readFileSync(p,'utf-8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v}}
le('.env.production.local'); le('.env.local')

async function main() {
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { analizarSaludDeConfiguracion } = await import('@/lib/clinic/salud-configuracion')
  const { SaludConfiguracionPanel } = await import('@/components/dashboard/salud-configuracion-panel')
  const id = process.argv[2] ?? 'dac775fe-6ebd-47e3-89b4-eeb1a821facb'
  const salud = await analizarSaludDeConfiguracion(id)
  const html = renderToStaticMarkup(React.createElement(SaludConfiguracionPanel, { salud }))
  // Volcar el HTML a texto legible, que es lo que va a leer la clínica.
  const texto = html
    .replace(/<\/(div|p|h2|a|span)>/g, '</$1>\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
  console.log('══════ LO QUE VE LA CLÍNICA ══════\n')
  console.log(texto)
  console.log(`\n══════ enlaces renderizados ══════`)
  for (const m of html.matchAll(/href="([^"]+)"/g)) console.log('  →', m[1])
}
main().catch((e) => { console.error(e); process.exit(1) })
