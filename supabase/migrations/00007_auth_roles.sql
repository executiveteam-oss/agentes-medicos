-- ============================================================
-- Migración 00007: Autenticación, Roles y Permisos
-- Ejecutar en: Supabase SQL Editor
-- ============================================================

-- Añadir columna onboarded_at a clinics (para saber si ya completó el wizard)
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Tabla de roles por clínica (Admin, Doctor, Coordinadora, Secretaria, Contador)
CREATE TABLE IF NOT EXISTS clinic_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de usuarios vinculados a clínicas
-- Un auth.users puede pertenecer a varias clínicas (multi-tenant)
CREATE TABLE IF NOT EXISTS clinic_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE NOT NULL,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    full_name TEXT NOT NULL,
    role_id UUID REFERENCES clinic_roles(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clinic_id, auth_user_id)
);

-- RLS: habilitar seguridad por filas
ALTER TABLE clinic_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;

-- Política: solo puedo ver los roles de mi clínica
CREATE POLICY "Roles de mi clínica" ON clinic_roles FOR ALL TO authenticated
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_users
        WHERE auth_user_id = auth.uid() AND is_active = true
    ));

-- Política: solo puedo ver los usuarios de mi clínica
CREATE POLICY "Usuarios de mi clínica" ON clinic_users FOR ALL TO authenticated
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_users
        WHERE auth_user_id = auth.uid() AND is_active = true
    ));

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_clinic_users_auth ON clinic_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_clinic_users_clinic ON clinic_users(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_roles_clinic ON clinic_roles(clinic_id);
