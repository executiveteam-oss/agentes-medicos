-- ============================================================
-- 00077_authorizations_review_permission_and_media_flag.sql
-- Bloque 4 — Permiso authorizations.review separado de conversations.write
-- (aprobar una autorización es decidir elegibilidad clínica, más sensible).
-- + feature_flag media_reception_enabled=false por default (no procesa
-- archivos reales hasta activación explícita).
-- ============================================================

-- 1. Agregar permiso authorizations.review a los roles existentes.
--    Defaults: Admin/Coordinadora/Secretaria sí, Doctor/Contador no.

UPDATE clinic_roles
SET permissions = permissions || jsonb_build_object(
  'authorizations', jsonb_build_object('read', true, 'review', true)
)
WHERE name IN ('Admin', 'Coordinadora', 'Secretaria');

UPDATE clinic_roles
SET permissions = permissions || jsonb_build_object(
  'authorizations', jsonb_build_object('read', false, 'review', false)
)
WHERE name IN ('Doctor', 'Contador');

-- 2. Feature flag por clínica — apagado por default.
--    Solo se activa con UPDATE explícito después de:
--    (a) Meta Business Manager con número productivo migrado
--    (b) revisión legal Ley 1581 (ver CLAUDE.md sección bloque 4).

UPDATE clinics
SET feature_config = COALESCE(feature_config, '{}'::jsonb) || jsonb_build_object(
  'media_reception_enabled', false
)
WHERE NOT (COALESCE(feature_config, '{}'::jsonb) ? 'media_reception_enabled');

COMMENT ON COLUMN clinics.feature_config IS
  'Feature flags por clínica. Bloque 4: media_reception_enabled (default false). Ver CLAUDE.md para activación.';
