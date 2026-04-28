# Rediseno Vista Semana Agenda — Plan

## A. ARCHIVOS A TOCAR

| Archivo | Lineas actuales | Cambio estimado | Descripcion |
|---|---|---|---|
| `src/components/dashboard/calendar-view.tsx` | 425 | ~60 lineas mod | Reemplazar doctor pills por DoctorSelector, pasar doctor seleccionado a vistas |
| `src/components/dashboard/calendar/week-view.tsx` | 212 | ~120 lineas rewrite | Rediseno completo de celdas de cita + eliminar cascada diagonal |
| `src/components/dashboard/calendar/day-view.tsx` | 228 | ~15 lineas mod | Agregar toggle "Todos / Solo Dr. X" arriba de stat cards |
| `src/components/dashboard/calendar/doctor-selector.tsx` | **NUEVO** | ~120 lineas | Dropdown selector de doctor con avatar + persistencia localStorage |
| `src/components/dashboard/calendar/types.ts` | 116 | ~10 lineas | Agregar colores de estado hex para citas rediseñadas |
| `src/app/dashboard/agenda/page.tsx` | 126 | 0 | Sin cambios — carga todos los appointments del mes, el filtrado es client-side |

**Total estimado: ~325 lineas modificadas/creadas, 0 archivos eliminados.**

---

## B. NUEVO COMPONENTE: DoctorSelector

**Path:** `src/components/dashboard/calendar/doctor-selector.tsx`

**Props:**
```typescript
interface DoctorSelectorProps {
  doctors: CalendarDoctor[]
  selectedId: string
  onChange: (doctorId: string) => void
  restrictDoctorId?: string | null  // si doctor role, solo su doctor
}
```

**Comportamiento:**
- Render: pill con avatar 24px (iniciales + gradient) + nombre truncado + chevron down
- Click: dropdown con lista de doctores activos, cada uno con avatar + nombre + specialty muted
- Doctor con `agenda_closed`: lock icon + text line-through (seleccionable pero con warning)
- Seleccion: llama `onChange(doctorId)`, cierra dropdown
- Si `restrictDoctorId` presente: no mostrar selector (doctor fijo, solo render nombre)

**Persistencia localStorage (SSR-safe):**
```typescript
const STORAGE_KEY = 'agenda-selected-doctor-id'

// Solo en client
const [selectedDoctor, setSelectedDoctor] = useState(() => {
  if (typeof window === 'undefined') return doctors[0]?.id ?? ''
  const stored = localStorage.getItem(STORAGE_KEY)
  // Validar que stored existe en doctors activos
  if (stored && doctors.some((d) => d.id === stored)) return stored
  // Default: restrictDoctorId > primer doctor alfabetico
  return restrictDoctorId ?? doctors[0]?.id ?? ''
})

useEffect(() => {
  if (selectedDoctor) localStorage.setItem(STORAGE_KEY, selectedDoctor)
}, [selectedDoctor])
```

El state vive en `calendar-view.tsx` (orchestrator), no en el selector. El selector es controlled.

**Fallback si doctor en localStorage no existe:**
- Si el doctor stored fue desactivado o eliminado: ignorar, usar default (primer doctor)
- Log: `console.warn('[DoctorSelector] Stored doctor not found, using default')`

---

## C. ESQUEMA DE QUERIES

**Sin cambios en la query server-side.** La pagina carga TODAS las citas del mes (como hoy). El filtrado por doctor es client-side en `calendar-view.tsx`:

```typescript
// Ya existe esta logica:
const filteredAppointments = doctorFilter === 'all'
  ? appointments
  : appointments.filter((a) => a.doctor_id === doctorFilter)
```

**Cambio de comportamiento:**
- Vista semana: `filteredAppointments` siempre filtrado por doctor seleccionado (nunca 'all')
- Vista dia: `filteredAppointments` por doctor default, con toggle para 'all'
- Vista mes: `appointments` completos (sin filtro, como hoy)

**Riesgo de waste bandwidth:** No — la query trae ~200-500 citas/mes para toda la clinica. Filtrar client-side 9 doctores a 1 es trivial (array.filter). No vale la pena optimizar la query server-side para esto.

**iSalud blocked_external:** Estas citas tienen `doctor_id` asignado al doctor de iSalud. Se filtran correctamente con el selector. Si el doctor seleccionado tiene citas de iSalud, aparecen normalmente.

---

## D. PLAN DE TESTING MANUAL (12 casos)

1. **Selector funciona:** click abre dropdown, seleccionar doctor cambia vista
2. **Persistencia:** seleccionar Dr. B, navegar a /patients, volver a /agenda → Dr. B sigue seleccionado
3. **Default doctor role:** login como doctor → selector muestra solo su nombre, no dropdown
4. **Default admin:** primer doctor alfabetico pre-seleccionado
5. **Cambio de vista respeta filtro:** seleccionar Dr. A en semana, cambiar a dia → filtrado por Dr. A
6. **Toggle "Todos" en dia:** seleccionar Dr. A, cambiar a dia, toggle "Todos" → todas las citas visibles
7. **Vista mes no filtra:** cambiar a mes → todas las citas de todos los doctores
8. **Citas cortas (15 min):** verificar que truncan nombre/tipo con ellipsis, hover muestra completo
9. **Cita blocked_external (iSalud):** visible con color/estilo correcto
10. **Performance:** cambiar doctor con 100+ citas → UI no congela (<100ms)
11. **Keyboard shortcuts intactos:** h=hoy, d/w/m=vista, flechas=navegar
12. **Empty state:** doctor sin citas en la semana → "Sin citas esta semana"

---

## E. RIESGOS Y MITIGACION

| Riesgo | Prob | Impacto | Mitigacion |
|---|---|---|---|
| Doctor en localStorage ya no existe | Media | Bajo | Validar contra lista de doctors activos al leer. Si no existe, fallback a primer doctor. |
| Clinica sin doctores activos | Baja | Medio | Mostrar mensaje "No hay doctores activos. Agrega uno en Configuracion → Doctores." con link. |
| Doctor "external" de iSalud | Baja | Bajo | Doctores iSalud son doctores normales con is_active=true. Aparecen en el selector como cualquier otro. |
| Multi-clinic users | Baja | Bajo | localStorage key es global (`agenda-selected-doctor-id`). Si cambia de clinica, el stored doctor no existira en la nueva clinica → fallback automatico a primer doctor. |
| Algia odia el cambio | Baja | Alto | Rollback = git revert del commit. No hay feature flag — es mas rapido revertir que mantener flag. Si Lady pide volver, 1 comando. |
| Citas overlap en single-doctor | Muy baja | Bajo | Un doctor no deberia tener 2 citas simultaneas (el bot las valida). Si existe por manual entry, apilar side-by-side (logica existente). |

---

## F. ESTIMACION

| Bloque | Horas | Notas |
|---|---|---|
| DoctorSelector componente | 1.5h | Dropdown, avatars, localStorage, fallback |
| Integracion en calendar-view.tsx | 1h | Reemplazar pills, pasar a vistas, URL state |
| Rediseno celdas semana | 2h | Nuevo layout con hora+nombre+tipo, colores por estado |
| Eliminar cascada diagonal | 0.5h | Simplificar: single doctor = sin overlap | |
| Toggle "Todos" en vista dia | 0.5h | Button toggle + logica condicional |
| Toolbar layout | 0.5h | Reordenar: selector + nav + view toggle |
| Hover/title en citas | 0.5h | title attribute con info completa (no tooltip component) |
| Testing manual (12 casos) | 1h | Probar cada caso |
| **Total** | **~7.5h** | **~1 dia de trabajo** |
