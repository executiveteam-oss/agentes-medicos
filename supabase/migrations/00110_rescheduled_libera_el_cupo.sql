-- Reagendar tiene que LIBERAR el cupo viejo.
--
-- rescheduleAppointment marca la cita original como 'rescheduled' e inserta una
-- fila nueva: la vieja es el original MUERTO. Pero este índice único parcial la
-- seguía contando, así que el cupo que la paciente dejó libre quedaba reservado
-- para siempre por una cita que ya no existe. Mover del 28 al 30 mataba el 28.
--
-- Va junto con sacar 'rescheduled' de BUSY_STATUSES (slot-availability.ts).
-- Las dos mitades son necesarias y NO se pueden separar: si el código deja de
-- verla ocupada pero el índice la sigue reservando, el agente ofrece el cupo y
-- el INSERT revienta con violación de unicidad — peor que no ofrecerlo.
--
-- 'blocked_external' sigue fuera del índice, como estaba: es lo que permite los
-- extras que autoriza el médico sobre un cupo ya tomado.
--
-- Alcance al aplicarla: 1 fila en toda la base (Algia, 19/08, ya pasada).
DROP INDEX IF EXISTS idx_appointments_no_double_booking;

CREATE UNIQUE INDEX idx_appointments_no_double_booking
  ON public.appointments USING btree (doctor_id, starts_at)
  WHERE (status = 'confirmed');
