# Demo Data — Centro Médico Bolívar

**Creado:** 2026-05-06
**Propósito:** Cuenta demo para reuniones de ventas
**Script:** `scripts/seed-demo-bolivar.ts`

## Credenciales

- **URL:** https://omuwan.co/login
- **Email:** demo@omuwan.co
- **Password:** Omuwan2026!

## Datos creados

| Tipo | Cantidad |
|------|----------|
| Clínica | 1 (Centro Médico Bolívar) |
| Doctores | 3 |
| Tipos de consulta | 7 |
| Pacientes | 30 (nombres ficticios colombianos) |
| Citas futuras | 18 (próximos 7 días) |
| Citas pasadas | 40 (último mes, mix completed/no-show/cancelled) |
| Conversaciones | 10 (con mensajes realistas) |
| Pending contacts | 3 (2 activos, 1 resuelto) |

## Doctores

| Nombre | Especialidad | Horario |
|--------|-------------|---------|
| Dr. Andrés Rodríguez | Medicina General | L-V 8 AM - 12 PM |
| Dra. Catalina Mejía | Pediatría | L, Mi, Vi 2-6 PM |
| Diana Castaño | Fisioterapia | Ma-Sá 7 AM - 1 PM |

## Teléfonos ficticios

Todos usan +573000000XX (claramente no reales).

## Cleanup

Para eliminar TODO lo de la demo:

```sql
-- Orden inverso de FKs
DELETE FROM pending_contacts WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b');
DELETE FROM conversations WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM appointments WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM consultation_types WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM patients WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM doctors WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM clinic_users WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM clinic_roles WHERE clinic_id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
DELETE FROM clinics WHERE id = 'feaa2b82-2957-4191-81a8-8e46a2c9396b';
```
