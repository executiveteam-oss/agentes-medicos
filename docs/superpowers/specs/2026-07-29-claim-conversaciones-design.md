# Claim de conversaciones (coordinación del equipo) — Design Spec

> **Estado:** ESPECIFICADO, NO construido. Decisión de construir pendiente de saber si el equipo de Algia trabaja en la MISMA oficina (se coordina hablando) o en TURNOS/remoto separados (necesita el claim en el sistema). Con 4 personas en la misma oficina, se maneja con convención.

> **Fecha:** 2026-07-29 · **Depende de:** la atribución de mensajes (feature B, ya construido — `messages.sender_name`), que resuelve el "quién respondió qué" del histórico.

## Problema

Algia tiene 3-4 personas en el equipo administrativo, todas en la misma clínica, todas viendo las mismas conversaciones escaladas. Hoy NO hay forma de repartirse el trabajo en el sistema:
- Sin asignación / "tomar" una conversación.
- Sin indicador de presencia ("María está viendo esto").
- Dos pueden abrir la misma conversación a la vez sin saberlo, y si ambas responden, **le llegan los dos mensajes a la paciente** (no hay lock).

Riesgo: doble-atención de la misma paciente. Con 4 personas en una oficina es manejable hablando; en turnos/remoto separados, no.

## Diseño mínimo

Reusa la infra de realtime que YA existe (`conversations-panel.tsx` escucha `conversations` UPDATE por Supabase Realtime), así que el "tomada por X" se propaga en vivo a las demás pantallas **sin plumbing nuevo**.

### Schema (migración)
```sql
ALTER TABLE conversations
  ADD COLUMN claimed_by UUID REFERENCES clinic_users(id),
  ADD COLUMN claimed_by_name TEXT,               -- denormalizado para display sin join
  ADD COLUMN claimed_at TIMESTAMPTZ;
```

### Lógica
- **Tomar**: al abrir una conversación escalada, server action `claimConversation(id)`:
  - Si está LIBRE (claimed_by NULL) o VENCIDA (claimed_at + X min < now) → setea claimed_by = yo, claimed_by_name = mi nombre, claimed_at = now.
  - Si está tomada por OTRO y vigente → no la toma; devuelve quién la tiene.
  - Idempotente (re-tomar la propia refresca claimed_at).
- **Auto-claim vs botón**: recomiendo **auto-claim al abrir** (menos fricción) + banner visible. Alternativa: botón "Tomar" explícito. Decisión de UX al construir.
- **Liberación**: se computa el vencimiento **al leer** (claimed_at + X min < now → libre). NO necesita cron. Botón "Liberar" opcional para soltarla antes.
- **X (ventana)**: propongo **10 minutos** — suficiente para atender una conversación, corto para que no quede trabada si alguien se distrae. Ajustable.

### Display
- **Lista** (`conversations-panel.tsx`): badge "🙋 Tomada por [nombre]" en las conversaciones tomadas vigentes. Realtime ya lo actualiza en vivo.
- **Header del chat** (`conversation-chat.tsx`): si otra persona la tiene tomada y vigente → banner "🙋 [nombre] está atendiendo esta conversación (hace N min)". Si la tenés vos → "La estás atendiendo vos".

### NO en alcance (mantener mínimo)
- Lock duro que impida responder si está tomada por otro (over-engineering para 4 personas; el banner + convención alcanza). Se puede agregar después si hay colisiones reales.
- Presencia en tiempo real tipo "escribiendo…" (Supabase Realtime Presence) — más complejo, innecesario para el volumen.
- Reasignación / cola de trabajo.

## Estimación
~1 sesión enfocada. Migración + 1 action + display en 2 lugares + expiry en read. El realtime ya está.

## Decisión pendiente antes de construir
¿El equipo trabaja en la misma oficina (convención alcanza, A es opcional) o en turnos/remoto (A es necesario)? Con esa respuesta se decide si entra y cuándo.
