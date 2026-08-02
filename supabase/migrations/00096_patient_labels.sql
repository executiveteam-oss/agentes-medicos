-- ============================================================
-- Etiquetas de PACIENTE (no de conversación). La etiqueta vive en la persona,
-- que es permanente por contacto — inmune a la rotación de 7 días del hilo
-- (frescura). Casos reales de Algia son de la paciente y duran meses:
-- "pendiente de ICER", "agendar en septiembre".
--
-- División: el ESTADO de triage es de la conversación (Atención/Pendiente/
-- Resuelta); la ETIQUETA es de la paciente. No compiten.
--
-- Modelo:
--   clinics.patient_labels  = catálogo de la clínica: [{id,name,color,archived?}]
--   patients.labels         = ids que tiene esa paciente: ["lbl_a1","lbl_b2"]
-- La paciente guarda ids; nombre/color se resuelven del catálogo (renombrar = gratis).
-- ============================================================
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS patient_labels JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Índice GIN para filtrar pacientes (y por ende conversaciones) por etiqueta.
CREATE INDEX IF NOT EXISTS idx_patients_labels ON patients USING GIN (labels);

COMMENT ON COLUMN clinics.patient_labels IS
  'Catálogo de etiquetas de paciente de la clínica: [{id,name,color,archived?}]. Se gestiona en el panel Equipo. Arranca vacío (nada hardcodeado).';
COMMENT ON COLUMN patients.labels IS
  'Ids de etiquetas de esta paciente (referencian clinics.patient_labels). Persisten por contacto, no por conversación.';
