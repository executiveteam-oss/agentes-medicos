// ============================================================
// LAS OPCIONES QUE VE QUIEN AGENDA — fuente única.
//
// El formulario de "Nueva cita" pasó de guardar `reason` en texto libre a
// guardar `consultation_type_id`. Eso le da a la cita precio, duración y reglas
// —lo que el invariante 5 exige y el panel se salteaba— pero obliga a elegir UNA
// fila del catálogo, y el catálogo real no es una grilla limpia.
//
// LO QUE HAY QUE SABER DEL CATÁLOGO DE VERDAD (medido en Algia, 2026-08-21):
//   · 80 filas activas para 33 nombres: el mismo servicio se repite por convenio.
//   · La DURACIÓN varía dentro del mismo nombre — "primera vez" es 20 min con un
//     médico y 30 con otro. No se puede derivar del nombre.
//   · Hay nombres duplicados con errata ("OBSTERICIA"/"OBSTETRICIA") y los DOS
//     tienen citas, con precios que difieren en más del doble ($46.100 y
//     $100.400 para el mismo médico y el mismo particular).
//   · No todos los servicios existen con todos los médicos.
//
// POR ESO CADA OPCIÓN LLEVA MÉDICO · DURACIÓN · PRECIO. No es adorno: es lo
// único que le permite a la secretaria distinguir dos filas que se llaman igual.
// Un desplegable mudo sobre este catálogo la haría elegir a ciegas, y el precio
// es lo que después le cobra a la paciente.
// ============================================================
import { supabaseAdmin } from '@/lib/supabase/admin'

/** Cómo se marca un convenio que la clínica todavía no cargó. */
export const CONVENIO_NO_LISTADO = '__otro__'

export interface OpcionServicio {
  id: string
  /** Lo que se muestra. display_name si existe; si no, el nombre crudo. */
  label: string
  /** El nombre crudo — para buscar por lo que la secretaria recuerde. */
  nameCrudo: string
  doctorId: string | null
  doctorNombre: string | null
  durationMinutes: number
  price: number | null
  /** null = particular. */
  epsName: string | null
  epsLabel: string | null
}

export interface GrupoServicio {
  key: string
  label: string
  doctorNombre: string | null
  durationMinutes: number
  /** Una variante por convenio. El PRECIO vive acá, no en el grupo: cada
   *  convenio paga distinto y eso es normal, no dos servicios diferentes. */
  variantes: OpcionServicio[]
}

/**
 * Todos los tipos agendables de la clínica.
 *
 * No filtra por médico: el formulario ya lo tiene y filtra en memoria. Traer las
 * 80 de una evita una consulta por cada cambio de médico.
 */
export async function opcionesDeAgendamiento(clinicId: string): Promise<OpcionServicio[]> {
  const { data } = await supabaseAdmin
    .from('consultation_types')
    .select('id, name, display_name, doctor_id, duration_minutes, price, eps_name, eps_display_name, doctors(name)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name')

  return (data ?? []).map((ct) => {
    const r = ct as unknown as {
      id: string; name: string; display_name: string | null
      doctor_id: string | null; duration_minutes: number; price: number | null
      eps_name: string | null; eps_display_name: string | null
      doctors: { name: string } | null
    }
    return {
      id: r.id,
      label: r.display_name?.trim() || r.name,
      nameCrudo: r.name,
      doctorId: r.doctor_id,
      doctorNombre: r.doctors?.name ?? null,
      durationMinutes: r.duration_minutes,
      price: r.price,
      epsName: r.eps_name,
      epsLabel: r.eps_display_name?.trim() || r.eps_name,
    }
  })
}

/** Sin tildes, sin mayúsculas, sin puntuación. */
export function normalizarParaBuscar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Filtra por texto. Busca en el label Y en el nombre crudo — la secretaria puede
 * recordar cualquiera de los dos, y con display_name puesto son distintos.
 *
 * Todas las palabras tienen que aparecer, en cualquier orden: "primera gineco"
 * encuentra "CONSULTA DE PRIMERA VEZ … GINECOLOGIA".
 */
export function filtrarGrupos(grupos: GrupoServicio[], termino: string): GrupoServicio[] {
  const palabras = normalizarParaBuscar(termino).split(' ').filter(Boolean)
  if (palabras.length === 0) return grupos
  return grupos.filter((g) => {
    const heno = normalizarParaBuscar(`${g.label} ${g.variantes.map((v) => v.nameCrudo).join(' ')}`)
    return palabras.every((p) => heno.includes(p))
  })
}

/**
 * Los servicios de UN médico, agrupados por NOMBRE + DURACIÓN.
 *
 * Las 10 filas de "primera vez" con Juan Diego son el mismo servicio repetido
 * por convenio: va UNA entrada y el convenio se elige después.
 *
 * La DURACIÓN sí entra en la clave, porque cambia el cupo que ocupa en la
 * agenda: "primera vez" de 20 min y de 30 min no son intercambiables al
 * agendar. El PRECIO no entra — varía por convenio, y eso es lo normal.
 *
 * ⚠️ Primera versión: la clave incluía el precio y "primera vez" con Juan Diego
 * salía CUATRO veces con el mismo nombre largo, diferenciadas sólo por el monto.
 * Un desplegable así es ilegible. El precio se muestra al elegir el convenio,
 * que es cuando la secretaria lo necesita.
 *
 * Lo que SÍ queda visible es la errata: "OBSTERICIA" y "OBSTETRICIA" son labels
 * distintos, así que siguen siendo dos entradas — que es correcto, porque son
 * dos filas distintas con precios particulares que difieren en más del doble.
 */
export function agruparPorMedico(opciones: OpcionServicio[], doctorId: string): GrupoServicio[] {
  const mapa = new Map<string, GrupoServicio>()
  for (const o of opciones.filter((x) => x.doctorId === doctorId)) {
    const key = `${o.label}|${o.durationMinutes}`
    const g = mapa.get(key)
    if (g) { g.variantes.push(o); continue }
    mapa.set(key, {
      key, label: o.label, doctorNombre: o.doctorNombre,
      durationMinutes: o.durationMinutes, variantes: [o],
    })
  }
  return [...mapa.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

/** El rango de precios de un grupo, para mostrarlo antes de elegir convenio. */
export function rangoDePrecios(g: GrupoServicio): string {
  const precios = [...new Set(g.variantes.map((v) => v.price).filter((p): p is number => p != null))].sort((a, b) => a - b)
  if (precios.length === 0) return 'sin precio'
  if (precios.length === 1) return precioCorto(precios[0])
  return `${precioCorto(precios[0])} – ${precioCorto(precios[precios.length - 1])}`
}

/** El precio en COP colombiano, sin decimales. */
export function precioCorto(price: number | null): string {
  return price ? `$${price.toLocaleString('es-CO')}` : 'sin precio'
}
