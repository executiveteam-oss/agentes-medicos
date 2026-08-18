# Auditoría de Honestidad — Landing Page Omuwan

**Fecha:** 2026-05-05  
**Archivo auditado:** `src/components/landing/landing-page.tsx`  
**Auditor:** Claude Code  

---

## 1. NÚMEROS Y ESTADÍSTICAS

### 1.1 "↓34%" — Reducción de no-shows
- **Ubicación:** Hero (L242), Floating card (L278), Solution (L528), Features (L558)
- **Fuente:** No documentada. No hay paper, estudio ni dato de Algia que respalde este número.
- **Inconsistencia:** El dashboard de notificaciones (`notification-settings-form.tsx:121`) dice **"hasta un 45%"**. Dos números distintos para la misma métrica.
- **Severidad:** CRÍTICO
- **Fix:** Elegir UN número y documentar la fuente. Si es proyección → decir "proyectado" o "en consultorios con 3 recordatorios activos". Si no hay dato → quitar el número y decir "Reduce significativamente tus no-shows".

### 1.2 "9,200+ Mensajes"
- **Ubicación:** Social Proof (L400)
- **Fuente:** Probablemente dato real de Algia (piloto). No verificado contra BD.
- **Problema:** Se presenta como "Resultados reales en clínicas reales" (plural) pero es UNA clínica piloto.
- **Severidad:** ALTO
- **Fix:** Cambiar header a "Resultados de nuestro piloto" o verificar el número contra `SELECT COUNT(*) FROM messages WHERE clinic_id = 'algia'`.

### 1.3 "87% Resueltos"
- **Ubicación:** Social Proof (L401), Solution (L529)
- **Fuente:** No documentada. ¿Cómo se define "resuelto"? ¿Incluye escalaciones parciales?
- **Severidad:** ALTO
- **Fix:** Documentar metodología. Si es "conversaciones que no requirieron intervención humana" → decirlo explícitamente. Verificar contra BD.

### 1.4 "3.2s Respuesta"
- **Ubicación:** Social Proof (L402), Floating card (L280)
- **Fuente:** Probablemente tiempo medio de respuesta del agente. Verificable técnicamente.
- **Severidad:** MEDIO
- **Fix:** Verificar contra logs. Si es correcto, OK. Si es estimado → aclarar.

### 1.5 "$1.8M Recuperados"
- **Ubicación:** Social Proof (L403)
- **Fuente:** No documentada. ¿Recuperados cómo? ¿Citas que se habrían perdido sin recordatorio? ¿En qué período?
- **Severidad:** CRÍTICO
- **Fix:** Explicar la metodología o quitar. "Recuperados" implica dinero real que entró gracias a Omuwan — ¿hay evidencia?

### 1.6 "~3 horas/día perdidas"
- **Ubicación:** Problem section (L438)
- **Fuente:** Estimación sin fuente.
- **Severidad:** MEDIO
- **Fix:** Agregar "según nuestras entrevistas con clínicas" o quitar la cifra.

### 1.7 "20-35% de tus citas son no-shows"
- **Ubicación:** Problem section (L443)
- **Fuente:** Rango de industria generalmente aceptado para consultorios en Colombia. Verificable con estudios.
- **Severidad:** BAJO
- **Fix:** Agregar fuente si la hay. El rango es razonable y no es claim propio.

### 1.8 "~$2.5M COP/mes perdidos"
- **Ubicación:** Problem section (L444)
- **Fuente:** Cálculo implícito (no-shows × precio consulta). No explicado.
- **Severidad:** MEDIO
- **Fix:** Explicar el cálculo: "Para un consultorio con X citas/día a $Y, un 25% de no-shows equivale a ~$2.5M/mes".

### 1.9 "+128 Citas/mes"
- **Ubicación:** Floating card (L279)
- **Fuente:** No documentada.
- **Severidad:** ALTO
- **Fix:** ¿128 citas agendadas vía Omuwan por mes en Algia? Verificar o quitar.

---

## 2. TESTIMONIOS Y QUOTES

- **No hay testimonios de clientes con nombre ni foto.** ✅ Bien — no hay riesgo de testimonios falsos.
- **No hay quotes atribuidas a personas específicas.** ✅
- **Recomendación:** Cuando tengas testimonios reales, pedir autorización escrita antes de publicar.

---

## 3. LOGOS DE EMPRESAS/CLÍNICAS

- **No hay logos de clientes en la landing.** ✅ Bien — no hay uso no autorizado de marcas.
- **No se menciona Algia por nombre.** ✅
- **Recomendación:** Si agregas logos, necesitás autorización escrita de cada clínica.

---

## 4. AFIRMACIONES VERIFICABLES

### 4.1 "Diseñado con clínicas reales en Colombia" (L219)
- **Verdad parcial.** Diseñado con UNA clínica real (Algia). "Clínicas" (plural) es exageración.
- **Severidad:** ALTO
- **Fix:** "Diseñado con una clínica real en Colombia" o "Diseñado para clínicas reales en Colombia".

### 4.2 "Resultados reales en clínicas reales" (L411)
- **Mismo problema.** Una clínica, no varias.
- **Severidad:** ALTO
- **Fix:** "Resultados de nuestro piloto en Colombia" o "Resultados reales de nuestra primera clínica".

### 4.3 "Implementación 7 días" (L265, L683)
- **¿Es verificable?** ¿Algia se implementó en 7 días?
- **Severidad:** MEDIO
- **Fix:** Si fue 7 días → OK. Si fue más → corregir. Necesita tu input.

### 4.4 "15 días prueba" (L857)
- **¿Existe trial de 15 días funcional?** Verificar en el sistema.
- **Severidad:** MEDIO
- **Fix:** Confirmar que el trial existe y funciona antes de prometer.

---

## 5. LENGUAJE QUE SUGIERE CAPACIDADES MÉDICAS

### 5.1 "agente médico real" (L571)
- **Ubicación:** Features section header
- **Problema:** "Agente médico" puede interpretarse como agente que da consejos médicos. Omuwan es un agente ADMINISTRATIVO, no médico.
- **Severidad:** CRÍTICO
- **Fix:** Cambiar a "agente administrativo real" o "asistente de consultorio real" o "agente de agenda real".

### 5.2 "Conoce tu clínica como tu mejor secretaria" (L591)
- **OK.** Compara con secretaria, no con médico. ✅

### 5.3 "Nunca inventa información" (L593)
- **Cuidado.** Los LLM pueden alucinar. La afirmación es aspiracional, no 100% garantizable.
- **Severidad:** MEDIO
- **Fix:** Matizar: "Está diseñado para no inventar información. Si no sabe algo, escala a tu equipo."

---

## 6. FEATURES QUE NO FUNCIONAN HOY

### 6.1 "Recordatorios 72h, 24h y 2h antes" (L558)
- **Estado real:** ¿Los templates de WhatsApp están aprobados por Meta? ¿Los recordatorios proactivos funcionan?
- **Severidad:** ALTO si no funcionan
- **Fix:** Necesita tu input — ¿están funcionando en Algia hoy?

### 6.2 "Integración iSalud" (L726, plan Clínica)
- **Estado real:** ¿Existe la integración o es roadmap?
- **Severidad:** ALTO si es roadmap
- **Fix:** Si no existe → mover a "Próximamente" o quitar del plan.

### 6.3 "Lista de espera" (L726, plan Clínica)
- **Estado real:** ¿Implementado?
- **Severidad:** MEDIO
- **Fix:** Si no existe → quitar.

### 6.4 "API personalizada" (L727, plan Red)
- **Estado real:** ¿Existe?
- **Severidad:** MEDIO
- **Fix:** Si no existe → quitar o marcar como "bajo demanda".

### 6.5 "Reportes semanales" (L725, plan Equipo)
- **Estado real:** ¿Se envían automáticamente?
- **Severidad:** MEDIO
- **Fix:** Verificar.

---

## 7. ERRORES ORTOGRÁFICOS / TILDES

| Línea | Texto actual | Corrección |
|-------|-------------|------------|
| L84 | "Como funciona" | "Cómo funciona" |
| L219 | "clinicas" | "clínicas" |
| L235 | "tu atiendes" | "tú atiendes" |
| L241 | "Reagendan" | OK (sin tilde) |
| L259 | "Ver como funciona" | "Ver cómo funciona" |
| L291 | "¿Que tipo de consulta" | "¿Qué tipo de consulta" |
| L293 | "¿Manejas alguna EPS o seria particular?" | "¿...o sería particular?" |
| L297 | "quedo agendada" | "quedó agendada" |
| L330 | "Tu Clinica" | "Tu Clínica" |
| L436 | "todo el dia" | "todo el día" |
| L437 | "¿Cuanto cuesta?" "¿Donde quedan?" | "¿Cuánto...?" "¿Dónde...?" |
| L443 | "no confirman" | OK |
| L458 | "esta ahogando" | "está ahogando" |
| L464 | "mas crece" "mas WhatsApps" | "más crece" "más WhatsApps" |
| L517 | "La solucion" | "La solución" |
| L523 | "tu clinica" | "tu clínica" |
| L528 | "Reduccion" | "Reducción" |
| L558 | "Reduce no-shows hasta 34%" | OK gramaticalmente |
| L559 | "Escalamiento automatico" | "Escalamiento automático" |
| L559 | "cuando pasarte la conversacion" | "cuándo pasarte la conversación" |
| L568 | "Como lo hace" | "Cómo lo hace" |
| L571 | "agente medico" | "agente médico" |
| L593 | "informacion" | "información" |
| L600 | "¿Cuanto cuesta la cita?" | "¿Cuánto cuesta...?" |
| L671 | "como funciona" | "cómo funciona" |
| L672 | "tecnica" | "técnica" |
| L680 | "Implementacion" | "Implementación" |
| L683 | "7 dias" | "7 días" |
| L724-727 | "medico/medicos" | "médico/médicos" |
| L725 | "automaticos" | "automáticos" |
| L778 | "Mas popular" | "Más popular" |
| L837 | "¿Mas de 10 medicos..." | "¿Más de 10 médicos..." |
| L869-876 | Múltiples tildes faltantes en FAQ | Ver detalle abajo |
| L869 | "¿Mis pacientes notan que es un agente, no una persona?" | OK |
| L870 | "¿Tengo que cambiar mi numero de WhatsApp?" | "número" |
| L871 | "¿Que pasa si Omuwan se equivoca...?" | "¿Qué pasa...?" |
| L871 | "no esta seguro" | "no está seguro" |
| L872 | "¿Cuanto tarda...?" | "¿Cuánto tarda...?" |
| L872 | "7 dias habiles" | "7 días hábiles" |
| L873 | "¿Mis datos medicos estan seguros?" | "médicos están" |
| L873 | "encriptacion" | "encriptación" |
| L875 | "integracion directa" | "integración directa" |

**Total: ~40+ tildes faltantes.**
**Severidad:** MEDIO (afecta profesionalismo ante médicos educados)
**Fix:** Agregar todas las tildes. Se puede hacer en batch.

---

## 8. RESUMEN POR SEVERIDAD

### CRÍTICO (3)
1. **"↓34%" sin fuente** + inconsistencia con 45% del dashboard
2. **"$1.8M Recuperados" sin metodología**
3. **"agente médico real"** sugiere capacidad médica

### ALTO (6)
4. **"clínicas reales" (plural)** cuando es 1 clínica
5. **"9,200+ Mensajes"** de 1 piloto presentado como generalizado
6. **"87% Resueltos"** sin definición de "resuelto"
7. **"+128 Citas/mes"** sin fuente
8. **Integración iSalud** — ¿existe o es roadmap?
9. **Recordatorios proactivos** — ¿templates aprobados?

### MEDIO (7)
10. "3 horas/día perdidas" sin fuente
11. "$2.5M COP/mes perdidos" sin cálculo explícito
12. "Implementación 7 días" — ¿verificado?
13. "15 días prueba" — ¿funciona el trial?
14. "Nunca inventa información" — aspiracional
15. Lista de espera / API / Reportes — ¿existen?
16. ~40 tildes faltantes

### BAJO (1)
17. "20-35% no-shows" — rango de industria, razonable

---

## 9. DECISIONES QUE NECESITAN INPUT DE JUAN

| # | Pregunta | Impacto |
|---|----------|---------|
| 1 | ¿El 34% sale de algún dato de Algia? | Decide si se queda o se quita |
| 2 | ¿Los $1.8M son calculados o inventados? | Decide si se queda o se quita |
| 3 | ¿Los recordatorios proactivos funcionan hoy en Algia? | Decide si el feature se lista como activo |
| 4 | ¿La integración iSalud existe o es roadmap? | Decide si se quita del plan Clínica |
| 5 | ¿Algia se implementó en 7 días reales? | Verifica el claim |
| 6 | ¿El trial de 15 días está funcional en el sistema? | Verifica antes de prometer |
| 7 | ¿Querés cambiar "agente médico" a "agente administrativo"? | Elimina riesgo legal |
