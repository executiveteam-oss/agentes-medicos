-- 00097 — Sacar de `public` (sin RLS) los backups de catálogo con tarifas por
-- convenio + poner RLS a eapb_codes.
--
-- Contexto: 4 tablas quedaron en `public` SIN RLS tras las migraciones de julio:
--   _bkp_ct_20260709, _bkp_ct_20260710  (backups de consultation_types — 78 filas
--       c/u, 66 con precio, 17 convenios: TARIFAS NEGOCIADAS CONFIDENCIALES)
--   _bkp_ctr_20260709                    (backup de consultation_type_rules — 2 filas)
--   _bkp_cts_20260709                    (backup de consultation_type_schedules — vacío)
-- Sin RLS en `public` = legibles con la publishable/anon key. Es la misma tarifa
-- por convenio que sacamos del contexto del agente (fix A y B1), expuesta por
-- otro lado.
--
-- Decisión: NO borrar los backups (siguen siendo respaldo) — moverlos a un
-- esquema `backups` que PostgREST no expone. Así dejan de ser alcanzables por la
-- API; solo el service_role (que bypassa esto) los ve.

CREATE SCHEMA IF NOT EXISTS backups;
REVOKE ALL ON SCHEMA backups FROM anon, authenticated;

ALTER TABLE public._bkp_ct_20260709  SET SCHEMA backups;
ALTER TABLE public._bkp_ct_20260710  SET SCHEMA backups;
ALTER TABLE public._bkp_ctr_20260709 SET SCHEMA backups;
ALTER TABLE public._bkp_cts_20260709 SET SCHEMA backups;

-- Belt-and-suspenders: quitar grants heredados de public a los roles de API,
-- por si algún día se expone el esquema `backups`.
REVOKE ALL ON backups._bkp_ct_20260709  FROM anon, authenticated;
REVOKE ALL ON backups._bkp_ct_20260710  FROM anon, authenticated;
REVOKE ALL ON backups._bkp_ctr_20260709 FROM anon, authenticated;
REVOKE ALL ON backups._bkp_cts_20260709 FROM anon, authenticated;

-- eapb_codes: catálogo de códigos EAPB (no dato de clínica), pero no tiene por
-- qué estar abierto a la anon key. RLS + SELECT solo para autenticados. El
-- server (service_role) bypassa RLS → los reportes Res-256 lo siguen leyendo.
ALTER TABLE public.eapb_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eapb_codes_select_authenticated"
  ON public.eapb_codes
  FOR SELECT
  TO authenticated
  USING (true);
