# Clínicas — Backlog de limpieza

**Fecha:** 2026-05-06

## Clínicas legacy pendientes de decisión

### [ABANDONED] LondoMEdical #1
- **ID:** `961e98e7-f011-4f73-aa85-4ab1d608f95c`
- **Creada:** 2026-04-08
- **Estado:** Vacía (0 doctores útiles, 0 pacientes, 0 citas, 0 conversaciones)
- **WhatsApp:** No conectado
- **Usuarios:** Ninguno visible
- **Acción recomendada:** Borrar cuando convenga. Sin riesgo.

### [TESTING] LondoMEdical #2
- **ID:** `eb1ab762-7265-40cc-bf6e-ea7d49c9c9af`
- **Creada:** 2026-04-13
- **Estado:** Testing personal de Juan Londoño con sync iSalud
- **Datos:** 9 doctores (mismos de ALGIA), 461 citas importadas de iSalud, 1 paciente (Juan Londoño), 1 conversación activa
- **WhatsApp:** Phone ID `1025696970620733` conectado
- **Usuarios:** executive.team@loncocapital.com (Admin), 1743@lfp.edu.co (Doctor)
- **Acción recomendada:** Conservar hasta que ALGIA tenga tráfico real estable. Luego:
  1. Desconectar WhatsApp (liberar phone_id)
  2. Borrar clínica completa
  3. O conservar como referencia histórica del primer sync

### Phone IDs en uso
| Phone ID | Clínica | Estado |
|---|---|---|
| `995077510364945` | ALGIA | Producción activa |
| `1025696970620733` | [TESTING] LondoMEdical | Legacy — liberar cuando se borre |

## Otras clínicas residuales
- 7x "Los Puchis" (mar 2026) — pruebas tempranas, vacías
- 2x "Gavilanes" (abr 2026) — pruebas, vacías
- 2x "Consultorio Dr. Prueba" — pruebas, vacías
- 1x "Clínica Dental Sonrisa" (feb 2026) — primera prueba
- 1x "Consultorio Médico Demo" (abr 2026) — demo@omuwan.co desactivada
- 1x "Chiminango" (may 2026) — nueva, vacía

**Limpieza total estimada:** Borrar ~15 clínicas vacías en un batch. Sin riesgo. Pendiente para sprint de limpieza.
