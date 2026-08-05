# Cliente: Algia

> Contexto durable del primer cliente real de Omuwan. **Estado de la DB no se copia acá** —
> médicos, horarios, convenios, conteos, `clinic_id`, teléfonos y templates se consultan.
> Acá va lo que no está en ninguna tabla: quién es, cómo opera y qué decisiones se tomaron.

Para identificar la clínica en una query: `SELECT id FROM clinics WHERE slug = 'algia';`

---

## Quién es

Consultorio especializado en **dolor pélvico y ginecología**, en Pereira (Risaralda). Varios
profesionales, entre ginecología, fisioterapia, colposcopia, psicología e imágenes. Atiende
particular, EPS y medicina prepagada.

Es el **piloto**: el único cliente con pacientes reales. Todo lo demás en la base es demo o
pruebas nuestras. Cualquier escritura sobre sus datos es producción real, sin lugar donde
practicar.

**Consecuencia práctica del negocio:** que sea una clínica de dolor significa que *"vengo por
dolor"* es la razón de consulta de la mayoría de las pacientes, no una señal de urgencia. Las
listas de keywords de escalación que parecen sensatas en abstracto ("dolor", "médico") acá
escalan a casi todo el mundo. Vocabulario normal del dominio ≠ señal de urgencia.

---

## Cómo opera el staff

- **Siguen trabajando en iSalud** (su HIS) mientras dura la transición. La agenda vive en los dos
  lados a la vez.
- La coordinación de agenda la lleva una persona que revisa el tablero de Omuwan; las secretarias
  atienden la bandeja de conversaciones.
- **Las secretarias escanean con el celular las órdenes y autorizaciones** para radicarlas, y las
  archivan en carpetas propias por convenio. Llegan órdenes externas a diario. Por eso la
  descarga de autorizaciones tiene que servir **sin importar la fecha** y con un nombre de archivo
  que ellas puedan archivar directo — el formato del nombre es de ellas, no nuestro: se pregunta,
  no se adivina, y se deja fácil de cambiar.
- Casi todas las pacientes usan **Android** (el archivo se descarga primero, no se abre solo en
  la app de calendario). El wording de cualquier mensaje con adjunto o link tiene que asumir eso.

---

## Transición Algia ↔ iSalud

El sync es **unidireccional**: iSalud → Omuwan. Las citas que crea el agente **no vuelven a
iSalud**, así que existe riesgo real de doble agendamiento. Mitigaciones vigentes mientras dure
la convivencia:

1. **Notificación al staff por WhatsApp** por cada cita que crea el agente, con el recordatorio
   de no agendar esa hora en iSalud. Fire-and-forget. **Transitorio** — muere cuando corten
   iSalud.
2. **Revisar la agenda de Omuwan antes de agendar en iSalud.** Las citas importadas y las creadas
   por el agente conviven en la misma vista; las importadas se muestran como bloqueadas.
3. Las citas importadas ocupan cupo para el agente igual que las propias (`BUSY_STATUSES`), así
   que el agente nunca ofrece un horario que iSalud ya tomó.

**Las escalaciones se atienden dentro de Omuwan** — bandeja, pestaña de Atención y campana. No
hay segundo canal por WhatsApp al staff, y fue decisión deliberada: una alerta que un domingo a
las 11 de la noche no le llega a nadie es peor que no prometerla.

Cuando Algia corte iSalud para agenda, se apagan y se borran el adapter, el sync-agent y su
endpoint de cron.

---

## ⏳ El código de iSalud es migración de un solo uso

**Decisión de alcance.** Todo lo que toca iSalud — sync de citas, importador de convenios y de
pacientes, parseo de aseguradora, derivación de tipos de consulta — es **infraestructura de
migración de este cliente**, no feature del producto Omuwan.

Razón: Algia es el único cliente que migra desde iSalud. Los que vengan configuran sus horarios,
convenios y tipos de consulta directamente en Omuwan, desde cero.

Implicaciones, para no perder tiempo en sesiones futuras:

1. **No generalizar.** Puede ser Algia-specific y hardcodeado. Lo que importa es que los datos de
   Algia queden bien, no que el método sirva para otros.
2. **No reusar para otro cliente.** Si algún día otro migra desde iSalud, se diseña un importador
   nuevo con lo aprendido. Esto no es plantilla.
3. **Tiene fecha de caducidad.** Cuando Algia opere 100% en Omuwan se borra entero. No tiene
   valor histórico.
4. **No tratarlo como deuda técnica a refactorizar.** Feo, single-purpose y hardcodeado es
   *feature*, no bug. No invertir en dejarlo bonito.
5. **La cautela sobre los datos NO se relaja por ser de un solo uso.** Ver arriba: es el único
   cliente real.

**Cómo distinguir:** si vive en `src/lib/isalud/`, si tiene `isalud` en el nombre, o si habla de
conceptos del HIS (admisión, profesional, disponibilidad, convenio importado) → es migración. Si
habla de citas, doctores, tipos de consulta, agente o dashboard → es producto.

---

## Decisiones tomadas que no se revisan sin motivo nuevo

### Los horarios NO se importan de iSalud

Se configuran a mano en Omuwan. El diagnóstico se hizo y se descartó la importación:
`/disponibilidad` **subestima** la jornada real (muestra solo los slots publicados para
agendamiento web), y derivarla de las citas históricas la subestima por el otro lado (quien
atiende de 8 a 18 puede tener su primera cita a las 9). Se encontraron casos concretos de
profesionales marcados como inactivos un día en el que sí atienden, y de jornadas capturadas a la
mitad.

Quedó en el repo, sin uso productivo, el módulo de derivación de patrón semanal y el script de
diagnóstico. Si alguna vez se reintenta, la fuente menos mala son **las citas ya acumuladas en
Omuwan**, no iSalud.

### Integraciones sandbox de iSalud — NO REACTIVAR

Hay filas de `sync_integrations` marcadas `disabled` con el prefijo `SANDBOX — DO NOT ENABLE` en
`sync_error`. Una de ellas apunta **al mismo subdominio del cliente real** con credenciales
inválidas: reactivarla golpea el iSalud productivo de Algia con logins fallidos cada media hora,
con riesgo de bloquear la cuenta. Otra apunta a un subdominio que ni siquiera resuelve.

El cron las excluye por `sync_status = 'disabled'`. **Si en alguna sesión aparece la idea de
"reactivar todas las integraciones deshabilitadas de golpe": parar y leer esto.** Si hace falta un
sandbox de verdad, se crea una clínica de pruebas con su propio subdominio — nunca reutilizando
el del cliente.

---

## Deudas abiertas de la migración

### 🔴 El match de procedimiento ignora el convenio (severo)

`matchProcedureToStaging` (`src/lib/isalud/consulta-convenio-derivation.ts`) busca el producto del
staging **solo por nombre de procedimiento** y devuelve el primer match. Como el mismo
procedimiento existe una vez por cada convenio, todas las combinaciones derivadas terminan
apuntando al mismo producto — el de un convenio arbitrario.

No bloquea el flujo, pero **degrada el precio sugerido**, y la dispersión de tarifas entre
convenios para un mismo procedimiento es de 3-4× entre el mínimo y el máximo. Si se confirman
varias filas sin editar precio uno por uno, quedan todas con la tarifa equivocada — y después el
agente cotiza con ella.

Fix: pasarle el convenio canónico (ya está calculado en el scope de quien la llama) y seleccionar
el producto que matchea por ambos, con fallback al match por nombre si ese convenio no está.

### Variantes del nombre del mismo convenio

El staging trae el mismo convenio escrito de muchas formas (espacios dobles, `S.A.` vs `SA` vs
`S.A`, punto de más). La mayoría de los productos no matchea contra `eapb_codes` por eso.

No bloquea — el catálogo los muestra igual y se pueden clasificar a mano — pero deja el dropdown
lleno de duplicados aparentes y, sobre todo, **si dos profesionales eligen variantes distintas del
mismo convenio real, el reporte regulatorio queda con dos entradas para una sola entidad.**

Fix: normalizar antes del match (colapsar espacios, quitar puntos, unificar sufijos societarios) y
agregar aliases canónicos.

### Import de pacientes: los que chocaron por teléfono duplicado

Un puñado de clientes de iSalud no se importaron porque su teléfono ya existía en otro paciente
con cédula distinta. Hipótesis: familiares que comparten número, o errores de digitación del
propio HIS. **Decisión: no se resuelven de forma masiva.** Si alguno escribe por WhatsApp, se crea
en ese momento. El detalle no quedó persistido; para reconstruir el listado hay que re-correr el
importador en dry-run.

---

## Pendientes de configuración (del cliente, no de código)

- Poblar los tipos de consulta profesional por profesional con el importador doctor-first
  (`/dashboard/settings/doctors/[id]` → tab de tipos de consulta → importar sugerencias). Nada se
  aplica solo: revisa, ajusta y confirma.
- Configurar los horarios reales a mano (ver decisión arriba).
- Auditar los códigos EAPB antes del primer reporte de Resolución 256 (detalle en `CLAUDE.md`).

---

*Contexto durable. Todo lo que cambie solo — quién está activo, qué horarios tiene, cuántos
pacientes hay — se consulta en la DB, no se escribe acá.*
