-- ============================================================
-- 00074_consultation_type_rules.sql
--
-- Reglas configurables por tipo de consulta. Diseño en CLAUDE.md
-- sección "Sistema de reglas configurables".
--
-- 6 tipos de regla (CHECK incluye los 6 desde el inicio para que la
-- columna no necesite ALTER cuando se construyan los bloques 2-6):
--   escalate_human         — el bot no agenda, deriva al staff
--   age_limit              — restricción por rango de edad
--   patient_condition      — pregunta sí/no que el agente hace
--   requires_authorization — informa que el servicio requiere autorización
--   special_message        — texto libre que el agente comunica
--   clinical_doc_review    — revisar documento clínico (legalmente pendiente)
--
-- updated_at se mantiene desde el código (las server actions setean
-- explícitamente — no hay trigger porque la función de updated_at vive
-- en el schema 'storage' de Supabase y no está disponible en public).
--
-- Aplicada en producción: 2026-06-23
-- ============================================================

CREATE TABLE consultation_type_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_type_id UUID NOT NULL REFERENCES consultation_types(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'escalate_human',
    'age_limit',
    'patient_condition',
    'requires_authorization',
    'special_message',
    'clinical_doc_review'
  )),

  condition_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  action TEXT NOT NULL CHECK (action IN (
    'derivar_humano',
    'informar_y_agendar',
    'informar_y_derivar',
    'rechazar'
  )),

  message TEXT,

  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ctr_consultation_type_active
  ON consultation_type_rules(consultation_type_id)
  WHERE active = true;

CREATE INDEX idx_ctr_clinic ON consultation_type_rules(clinic_id);

ALTER TABLE consultation_type_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY rules_select_own_clinic ON consultation_type_rules
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY rules_insert_own_clinic ON consultation_type_rules
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY rules_update_own_clinic ON consultation_type_rules
  FOR UPDATE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY rules_delete_own_clinic ON consultation_type_rules
  FOR DELETE TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users
    WHERE auth_user_id = auth.uid() AND is_active = true
  ));

COMMENT ON TABLE consultation_type_rules IS
  'Reglas configurables por tipo de consulta (bloques 1-6 del diseño). Ver CLAUDE.md.';
