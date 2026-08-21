-- Nombre para mostrar de un tipo de consulta.
--
-- El catálogo de Algia vino del import de iSalud con razones sociales completas
-- en el convenio ("ENTIDAD PROMOTORA DE SALUD SERVICIO OCCIDENTAL DE SALUD S.A"
-- son 59 caracteres y quieren decir SOS) y con nombres de servicio en mayúscula
-- sostenida y con erratas.
--
-- Limpiarlo en la UI sería el error: si la pantalla dice "SOS" y la base dice la
-- razón social, quedan dos nombres para la misma cosa y el matcheo del agente
-- sigue usando el largo. Es el patrón 8 — lo que se muestra tiene que salir del
-- mismo lugar que lo que se usa.
--
-- Por eso el nombre bonito vive en la FILA, opcional. Cuando está, lo usa todo
-- lo que lee una persona; cuando está vacío, cae al nombre crudo. El dato que
-- matchea el agente (`name`, `eps_name`) no se toca.
alter table public.consultation_types
  add column if not exists display_name text,
  add column if not exists eps_display_name text;

comment on column public.consultation_types.display_name is
  'Nombre del servicio para mostrar a una persona. NULL = usar name.';
comment on column public.consultation_types.eps_display_name is
  'Nombre del convenio para mostrar. NULL = usar eps_name.';
