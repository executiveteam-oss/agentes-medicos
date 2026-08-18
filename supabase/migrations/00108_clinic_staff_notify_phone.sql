-- ============================================================
-- Separar el teléfono PÚBLICO del teléfono de NOTIFICACIONES AL STAFF.
--
-- ⚠️ PREPARADA, NO APLICADA. No correr `supabase db push` con esta migración
--    hasta que se apliquen también los 3 call sites de abajo: si la columna
--    existe pero el código sigue leyendo `phone`, no cambia nada; y si se
--    cambia el código sin la columna, se rompen las notificaciones.
--
-- POR QUÉ
-- `clinics.phone` tenía dos usos incompatibles en la misma columna:
--   1. PÚBLICO   — el system prompt lo inyecta en "INFO DEL CONSULTORIO" y el
--                  agente se lo da a la paciente (system-prompt.ts:352).
--   2. INTERNO   — destino WhatsApp de las notificaciones al staff.
--
-- El 2026-08-17 se cambió `phone` de Algia porque el agente estaba dando el
-- número corporativo de la admin y las pacientes se salían del canal. Ese
-- cambio arregló el uso (1) y arrastró el (2) con él: los avisos de cita nueva
-- y el reporte semanal se mudaron al número público en el mismo movimiento.
--
-- Un valor que responde dos preguntas distintas diverge en cuanto una de las
-- dos cambia. Acá ya divergió.
-- ============================================================

alter table public.clinics
  add column if not exists staff_notify_phone text;

comment on column public.clinics.phone is
  'Teléfono PÚBLICO. El agente se lo da a la paciente (system-prompt.ts). NO es destino de notificaciones.';

comment on column public.clinics.staff_notify_phone is
  'Teléfono INTERNO del staff: destino WhatsApp de reporte semanal, aviso de cita creada y onboarding. NUNCA se muestra a la paciente. Si es NULL, el código cae a `phone` (compatibilidad).';

-- Backfill conservador: preserva EXACTAMENTE el comportamiento actual de todas
-- las clínicas. Nadie cambia de destino por aplicar esta migración.
-- `nullif(trim(...))` porque ocho clínicas tienen `phone` en string VACÍO, no
-- en NULL: copiarlo tal cual dejaría '' en la columna nueva. El código lo trata
-- igual que vacío, pero NULL es lo que esos registros realmente significan.
update public.clinics
set staff_notify_phone = nullif(trim(phone), '')
where staff_notify_phone is null
  and nullif(trim(phone), '') is not null;

-- ALGIA — las notificaciones de staff VUELVEN al número de la admin.
--
-- El backfill de arriba las dejaría en el número público nuevo
-- (+573046650214), que es donde cayeron el 2026-08-17 como efecto colateral de
-- cambiar `phone`. Toda la razón de esta columna es deshacer ese arrastre:
-- dejar las notificaciones donde estaban ANTES del cambio de número público.
--
-- Si mañana deciden que las mire otra persona, se cambia el DATO, no el código.
update public.clinics
set staff_notify_phone = '+573245820722'
where id = 'dac775fe-6ebd-47e3-89b4-eeb1a821facb';

-- ============================================================
-- CALL SITES A CAMBIAR EN EL MISMO COMMIT (leer staff_notify_phone ?? phone):
--
--   src/app/api/cron/weekly-report/route.ts:157   reporte semanal
--   src/lib/whatsapp/staff-appointment-notify.ts:53  aviso de cita creada
--   src/lib/whatsapp/onboarding-messages.ts:42    onboarding del admin
--
-- NO tocar:
--   src/agents/prompts/system-prompt.ts:352  → sigue leyendo `phone` (público)
--   src/app/actions/setup-progress.ts:62     → solo chequea que exista
--
-- Y agregar el campo al form de configuración de la clínica
-- (src/app/dashboard/settings/clinic/clinic-settings-form.tsx) para que no
-- quede solo editable por SQL.
-- ============================================================
