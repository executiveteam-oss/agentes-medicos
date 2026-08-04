-- ============================================================
-- Realtime para la bandeja de conversaciones (2026-08-04).
--
-- El front YA suscribía a conversations/messages, pero las tablas NO estaban en
-- la publicación → los eventos nunca llegaban (la campana sí anda porque
-- staff_notifications sí está publicada). Además el RLS de conversations/messages
-- filtra por email en `doctors` → las secretarias (clinic_users) quedaban fuera
-- del canal aunque se publicara.
-- ============================================================

-- 1) Publicar las tablas del inbox/detalle.
ALTER PUBLICATION supabase_realtime ADD TABLE conversations, messages;

-- 2) conversations: REPLICA IDENTITY FULL para que el filtro clinic_id funcione
--    también en DELETE (tabla chica, overhead nulo).
--    messages NO lleva FULL a propósito: su suscripción es INSERT-only filtrada
--    por conversation_id (presente en el row nuevo) y la tabla crece → no le
--    agregamos escritura extra al WAL.
ALTER TABLE conversations REPLICA IDENTITY FULL;

-- 3) RLS ADITIVO — patrón clinic_users (idéntico a conversation_media). NO quita
--    la política de doctor-email (RLS es permisivo = OR): los doctores conservan
--    acceso y las secretarias (clinic_users) lo ganan por el browser client.
--    Realtime respeta RLS en postgres_changes → aislamiento cross-clinic
--    garantizado en la DB (un auth.uid() de la clínica A jamás ve filas de B).
CREATE POLICY conversations_select_clinic_users ON conversations
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY messages_select_clinic_users ON messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT c.id FROM conversations c
      JOIN clinic_users cu ON cu.clinic_id = c.clinic_id
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );
