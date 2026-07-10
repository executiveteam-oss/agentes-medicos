-- Migración 00079: available_conventions para reemplazar el modelo de duplicación por convenio.
-- Aplicada en prod el 2026-07-10 vía MCP apply_migration.
--
-- Contexto: hasta este cambio, el catálogo tenía una fila por (servicio × convenio),
-- generando 45 duplicados en Algia (78 filas para 33 servicios reales). Post-cambio,
-- cada servicio es UNA fila con `available_conventions TEXT[]` = lista de convenios asociados.
-- El editor de auth por convenio (Bloque 4) lee de este array para poblar checkboxes.

ALTER TABLE consultation_types
  ADD COLUMN IF NOT EXISTS available_conventions TEXT[];

COMMENT ON COLUMN consultation_types.available_conventions IS
  'Lista de convenios que aceptan este servicio. Reemplaza el modelo viejo de "una fila por convenio". El editor de auth por convenio (Bloque 4) usa esta lista para poblar los checkboxes.';
