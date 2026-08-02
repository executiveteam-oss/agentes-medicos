-- ============================================================
-- Estado de TRIAGE de la conversación para la bandeja del staff.
-- SEPARADO de `status` (active/escalated/resolved) que gobierna el flujo del
-- agente. El problema de hoy: sin un estado intermedio, para sacar algo de la
-- cola de escaladas el equipo RESUELVE de más → conversaciones dadas por
-- cerradas que no lo están.
--
-- Modelo: 'pendiente' ("vista pero abierta") es el único estado que se PERSISTE
-- como override. 'atencion' y 'resuelta' se DERIVAN del status (escalated /
-- resolved) en la bandeja, así no hay que tocar los ~6 puntos de escalación ni
-- un trigger. Nullable = el agente la maneja (status active).
-- pending_owner_id / pending_since / pending_note llegan en la Etapa 3.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS triage_state TEXT
  CHECK (triage_state IN ('atencion', 'pendiente', 'resuelta'));

CREATE INDEX IF NOT EXISTS idx_conversations_triage
  ON conversations(clinic_id, triage_state) WHERE triage_state IS NOT NULL;

COMMENT ON COLUMN conversations.triage_state IS
  'Triage de bandeja del staff. pendiente = vista pero abierta (override persistido). Atención/Resuelta se derivan de status escalated/resolved. Abrir/leer NO lo cambia.';
