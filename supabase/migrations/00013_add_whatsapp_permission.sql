-- ============================================================
-- Agregar permiso 'whatsapp' a roles existentes que no lo tienen
-- Admin y Coordinadora obtienen read+write; los demás read-only si ya tienen 'asistente'
-- ============================================================

-- Admin: acceso total
UPDATE clinic_roles
SET permissions = permissions || '{"whatsapp": {"read": true, "write": true}}'::jsonb
WHERE NOT (permissions ? 'whatsapp')
  AND name = 'Admin';

-- Coordinadora: acceso total
UPDATE clinic_roles
SET permissions = permissions || '{"whatsapp": {"read": true, "write": true}}'::jsonb
WHERE NOT (permissions ? 'whatsapp')
  AND name = 'Coordinadora';

-- Otros roles: sin acceso
UPDATE clinic_roles
SET permissions = permissions || '{"whatsapp": {"read": false, "write": false}}'::jsonb
WHERE NOT (permissions ? 'whatsapp')
  AND name NOT IN ('Admin', 'Coordinadora');
