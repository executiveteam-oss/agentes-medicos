# Battery de reserva completada — Sonnet 5 vs Haiku 4.5 (Algia WhatsApp agent)

READ-ONLY harness. Tool results mocked, cero escritura a DB. Patient simulator:
modelo claude-sonnet-5 (persona fija, misma para ambos runs). Máximo 15 turnos de paciente.

## Resumen

| Modelo | Completó | Turnos | Agente in/out/cacheR/cacheW | Costo agente USD | Sim in/out | Costo sim USD |
|---|---|--:|---|--:|---|--:|
| sonnet | SÍ | 5 | 9808/2160/351360/0 | 0.167232 | 3596/217 | 0.014043 |
| haiku | SÍ | 5 | 9946/1780/234495/0 | 0.042295 | 4029/235 | 0.015612 |

---

## Transcript — SONNET
_completó=true · turnos=5 · costo agente=$0.167232_

**👤 Paciente (sim):** ¡Hola! Buenas tardes. Quisiera agendar una cita de ginecología, de primera vez. ¿Tienen disponibilidad el jueves en la mañana? Me gustaría con quien tenga el horario más pronto ese día.

**🤖 Agente (sonnet):** ¡Hola! Buenas, con gusto te ayudo 😊

Para ginecología de primera vez tenemos varios especialistas: el Dr. Jorge Darío López, la Dra. Angélica Quintero y el Dr. Juan Diego Villegas. ¿Tienes preferencia por alguno o te muestro el que tenga el primer horario disponible el jueves en la mañana?
  - _usage: in=319 out=135 cacheR=35136 cacheW=0_

**👤 Paciente (sim):** Sí, por favor, el que tenga el primer horario disponible el jueves en la mañana.

**🤖 Agente (sonnet):** Dame un momento para revisar la disponibilidad de los tres doctores el jueves en la mañana.

Los tres tienen el mismo primer horario disponible el jueves 30 de julio: 9:00 AM. Como están empatados, te propongo con el Dr. Jorge Darío López Isanoa a las 9:00 AM. ¿Te parece bien o prefieres elegir con cuál de los tres específicamente?
  - 🔧 `calculate_date`({"day_of_week":"jueves","reference":"this"})
  - 🔧 `check_availability`({"doctor_id":"069523a9-f13b-4268-a77c-514d54c5672c","preferred_date":"2026-07-30","preferred_time":"07:00","consultation_type_id":"b220060b-d8d6-49b8-889b-27626409e2e3"})
  - 🔧 `check_availability`({"doctor_id":"6a0c89a0-539e-4d75-a841-5742b3c9bd5b","preferred_date":"2026-07-30","preferred_time":"07:00","consultation_type_id":"c35a7305-3d95-4735-b62e-744a319f9494"})
  - 🔧 `check_availability`({"doctor_id":"97a20f5e-4aac-48d0-bef9-4240e666dca5","preferred_date":"2026-07-30","preferred_time":"07:00","consultation_type_id":"e3732aa4-2f26-466b-b43b-c262d9f488a5"})
  - _usage: in=3034 out=767 cacheR=105408 cacheW=0_

**👤 Paciente (sim):** Sí, con el Dr. Jorge Darío López está bien, a las 9:00 AM.

**🤖 Agente (sonnet):** Voy a revisar la disponibilidad real del Dr. Jorge Darío López para el jueves.

Confirmado, el Dr. Jorge Darío López tiene disponible el jueves 30 de julio a las 9:00 AM ✅

Antes de agendar necesito estos datos tuyos (mándamelos todos en un mensaje):
Nombre completo, tipo y número de documento (CC, TI, CE, PP o RC), fecha de nacimiento, correo electrónico, dirección y modalidad de pago (EPS, medicina prepagada o particular). Si es EPS o prepagada, dime el nombre de la aseguradora.
  - 🔧 `calculate_date`({"day_of_week":"jueves","reference":"this"})
  - 🔧 `check_availability`({"doctor_id":"069523a9-f13b-4268-a77c-514d54c5672c","preferred_date":"2026-07-30","preferred_time":"09:00","consultation_type_id":"b220060b-d8d6-49b8-889b-27626409e2e3"})
  - _usage: in=2740 out=478 cacheR=105408 cacheW=0_

**👤 Paciente (sim):** María Gómez, CC 1088123456, nacida 15/03/1990, correo maria@gmail.com, vivo en Pereira, pago particular.

**🤖 Agente (sonnet):** Antes de mostrarte los horarios, necesito confirmar una cosa rápido: ¿estás embarazada actualmente?
  - _usage: in=937 out=45 cacheR=35136 cacheW=0_

**👤 Paciente (sim):** No, no estoy embarazada.

**🤖 Agente (sonnet):** Voy a agendar tu cita con el Dr. Jorge Darío López para el jueves 30 de julio a las 9:00 AM.

✅ Cita confirmada con Dr. Jorge Darío López Isanoa
📅 Jueves 30 de julio a las 9:00 AM
📍 ALGIA — Oval medica, piso 11, consultorio 1104, AVENIDA JUAN B GUTIERREZ # 18-60 OVAL MEDICA, Pereira
💰 Costo: $46.100 COP (particular)

Te esperamos. Si necesitas cancelar o reagendar, escríbenos con anticipación.
Enseguida te llega un archivo 📅 para que guardes la cita en el calendario de tu celular. Ábrelo y toca "Agregar" y te recuerda solita antes de la cita.
  - 🔧 `create_appointment`({"doctor_id":"069523a9-f13b-4268-a77c-514d54c5672c","patient_name":"María Gómez","patient_phone":"+573001112233","starts_at":"2026-07-30T09:00:00-05:00","date_of_birth":"1990-03-15","document_type":"CC","document_number":"1088123456","consultation_type_id":"b220060b-d8d6-49b8-889b-27626409e2e3","patient_email":"maria@gmail.com","patient_address":"Pereira","procedure_entity":"particular","patient_condition_answers":{"0147769a-d4b1-4d26-aeda-77c583e82f1d":"no"}})
  - _usage: in=2778 out=735 cacheR=70272 cacheW=0_

---

## Transcript — HAIKU
_completó=true · turnos=5 · costo agente=$0.042295_

**👤 Paciente (sim):** ¡Hola! Buenas tardes 👋 Quisiera agendar una cita de ginecología, primera vez. ¿Tienen algo disponible el jueves en la mañana? Preferiría con quien tenga el horario más pronto ese día. ¡Gracias!

**🤖 Agente (haiku):** ¡Hola! Claro, con gusto te ayudo. Antes de revisar disponibilidad, necesito algunos datos tuyos.

Para agendar tu cita de ginecología necesito estos datos (mándamelos todos en un mensaje):

Nombre completo, tipo y número de documento (CC, TI, CE o Pasaporte), fecha de nacimiento, correo, dirección y modalidad de pago (¿vas a ir como particular, por EPS o por medicina prepagada?). Si es EPS o prepagada, dime el nombre.

Una vez me des eso, reviso disponibilidad para el jueves en la mañana 😊
  - _usage: in=512 out=163 cacheR=26055 cacheW=0_

**👤 Paciente (sim):** Claro! Te comparto mis datos:

María Gómez, CC 1088123456, nacida el 15/03/1990, correo maria@gmail.com, vivo en Pereira, pago particular.

**🤖 Agente (haiku):** Perfecto, gracias María. Antes de revisar los horarios, necesito confirmar una cosa rápido: ¿estás embarazada actualmente?
  - 🔧 `calculate_date`({"day_of_week":"jueves","reference":"this"})
  - _usage: in=1644 out=116 cacheR=52110 cacheW=0_

**👤 Paciente (sim):** No, no estoy embarazada.

**🤖 Agente (haiku):** Listo, gracias. Ahora voy a revisar disponibilidad para el jueves en la mañana.

Perfecto, el jueves es mañana (30 de julio). Ahora reviso disponibilidad con nuestros ginecólogos para la mañana:

Excelente, tengo disponibilidad para el jueves en la mañana. Los tres ginecólogos tienen el primer horario a las 9:00 AM:

Dr. Jorge Dario López Isanoa
Dra. Angélica María Quintero Montaño
Dr. Juan Diego Villegas Echeverri

Todos tienen a las 9:00 AM disponible. Como dijiste que prefieres con quien tenga el horario más pronto, cualquiera de los tres te queda en el mismo horario. ¿Con cuál prefieres?
  - 🔧 `calculate_date`({"day_of_week":"jueves","reference":"this"})
  - 🔧 `check_availability`({"doctor_id":"069523a9-f13b-4268-a77c-514d54c5672c","preferred_date":"2026-07-30","preferred_time":"08:00","consultation_type_id":"b220060b-d8d6-49b8-889b-27626409e2e3"})
  - 🔧 `check_availability`({"doctor_id":"6a0c89a0-539e-4d75-a841-5742b3c9bd5b","preferred_date":"2026-07-30","preferred_time":"08:00","consultation_type_id":"c35a7305-3d95-4735-b62e-744a319f9494"})
  - 🔧 `check_availability`({"doctor_id":"97a20f5e-4aac-48d0-bef9-4240e666dca5","preferred_date":"2026-07-30","preferred_time":"08:00","consultation_type_id":"df055e0b-cf1d-4a3b-a0e9-53aef6afece7"})
  - _usage: in=3729 out=762 cacheR=78165 cacheW=0_

**👤 Paciente (sim):** Ah bueno, ya que todos están a la misma hora, agéndame con el Dr. Jorge Darío López Isanoa, por favor.

**🤖 Agente (haiku):** Perfecto, María. Te confirmo los detalles antes de agendar:

✅ Cita de primera vez en Ginecología
✅ Dr. Jorge Dario López Isanoa
📅 Jueves 30 de julio a las 9:00 AM
💰 Costo: $46.100 COP (particular)
📍 ALGIA — Oval medica, piso 11, consultorio 1104, AVENIDA JUAN B GUTIERREZ # 18-60 OVAL MEDICA, Pereira

¿Confirmas esta cita? Responde sí o no.
  - _usage: in=1038 out=158 cacheR=26055 cacheW=0_

**👤 Paciente (sim):** Sí, confirmo.

**🤖 Agente (haiku):** ✅ Cita confirmada con Dr. Jorge Dario López Isanoa
📅 Jueves 30 de julio a las 9:00 AM
📍 ALGIA — Oval medica, piso 11, consultorio 1104, AVENIDA JUAN B GUTIERREZ # 18-60 OVAL MEDICA, Pereira
💰 Costo: $46.100 COP (particular)

Te esperamos. Si necesitas cancelar o reagendar, escríbenos con anticipación.

Enseguida te llega un archivo 📅 para que guardes la cita en el calendario de tu celular. Ábrelo y toca 'Agregar' y te recuerda solita antes de la cita. ¡Gracias! 😊
  - 🔧 `create_appointment`({"doctor_id":"069523a9-f13b-4268-a77c-514d54c5672c","patient_name":"María Gómez","patient_phone":"+573001112233","date_of_birth":"1990-03-15","document_type":"CC","document_number":"1088123456","starts_at":"2026-07-30T09:00:00-05:00","consultation_type_id":"b220060b-d8d6-49b8-889b-27626409e2e3","patient_email":"maria@gmail.com","patient_address":"Pereira","modality":"presencial","patient_condition_answers":{"0147769a-d4b1-4d26-aeda-77c583e82f1d":"no"}})
  - _usage: in=3023 out=581 cacheR=52110 cacheW=0_

---
