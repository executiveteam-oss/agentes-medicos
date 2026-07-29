-- ============================================================
-- 00085_doctors_gender.sql
-- Agrega doctors.gender ('M'/'F') para que el system prompt derive el
-- tratamiento correcto (Dr./Dra.) por médico, en vez de que el LLM lo adivine
-- (Haiku invirtió "la Dra. Jorge Darío"). Nullable → médicos sin género no
-- muestran título (el prompt omite, no adivina).
-- Aditiva. Aplicada en producción: 2026-07-29. Populate de los 7 de Algia.
-- ============================================================
BEGIN;

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS gender CHAR(1) CHECK (gender IN ('M', 'F'));

-- Algia — 2 hombres, 5 mujeres
UPDATE doctors SET gender = 'M' WHERE id IN (
  '069523a9-f13b-4268-a77c-514d54c5672c',  -- JORGE DARIO LOPEZ ISANOA
  '97a20f5e-4aac-48d0-bef9-4240e666dca5'   -- JUAN DIEGO VILLEGAS ECHEVERRI
);
UPDATE doctors SET gender = 'F' WHERE id IN (
  'eacf026c-4aef-49f9-9d0b-f6daf3f69ec1',  -- LINA MARIA GRAJALES MARULANDA
  'b5805347-4650-4eb1-a3a7-37b06f16b965',  -- DANIELA OSORIO POSADA
  '6a0c89a0-539e-4d75-a841-5742b3c9bd5b',  -- ANGELICA MARIA QUINTERO MONTAÑO
  '2c15822a-fb57-4f44-be94-e84f89be8c9c',  -- JAZMIN DANIELA GOMEZ RAMIREZ
  '2b0e5172-97ae-43a2-a1be-b266880191a5'   -- ADRIANA ESTEVEZ DURAN
);

COMMIT;
