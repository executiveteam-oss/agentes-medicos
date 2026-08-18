# BUG — Webhook HMAC inválido + Domain alias pegado a deploy viejo

**Fecha:** 4 de junio de 2026 (~14:00 COT)
**Reportado por:** Juan probando fix TZ con WhatsApp de Algia
**Severidad:** CRÍTICA — bloquea TODO el agente para Lady. Y descubrimos algo peor.
**Estado:** Phase 1 diagnóstico completo. SIN cambios aplicados.

---

## 🚨 ALERTA — Dos problemas independientes

Lo que vos pediste diagnosticar (HMAC) es UNO de DOS problemas. El segundo es mucho más grave:

**Problema A — HMAC rechazado** (lo que vos viste)
**Problema B — `omuwan.co` está pegado a un deploy del 16 de abril** y NINGUNO de mis deploys recientes (TZ fix, prepagada Sub-fase A, identity guards) está sirviendo tráfico. Lady ha estado hablando con código de hace ~7 semanas.

Antes de fixear A, hay que entender B porque cambia el plan.

---

## 1. Evidencia clave

### 1.1 Logs Vercel (filtrados por "Firma HMAC inválida")

```
13:54:36 → 13:57:04   POST /api/webhooks/whatsapp  → 403  × 20 reqs en 4 min
Deployment registrado en los logs: dpl_HPN2h49BFgPWEfGpFQWWwCuW7a8k
```

Todos los rejects en una explosión continua — coincide con Lady mandando mensajes.

### 1.2 Identidad del deploy que recibe el tráfico

`dpl_HPN2h49BFgPWEfGpFQWWwCuW7a8k`:
- Commit: `a774b6335` "fix(onboarding): useState → useEffect for loading roles dropdown"
- Fecha: **2026-04-16** (hace 49 días)
- Source: **cli** (`vercel deploy --prod` manual, no auto-deploy de git)
- `gitDirty: 1` (se desplegó código sin commitear)
- Actor: claude

**Y lo importante** — su lista de aliases:
```
"alias": [
  "omuwan.co",                          ← AQUÍ
  "www.omuwan.co",                      ← AQUÍ
  "agentes-medicos-ten.vercel.app",
  "agentes-medicos-executiveteam-oss-projects.vercel.app",
  "agentes-medicos-executiveteam-oss-executiveteam-oss-projects.vercel.app"
]
```

### 1.3 Identidad del deploy actual (último push)

`dpl_GXVcVU8JEifxm7tGMzUM4GLEZrd5` (fix TZ de hoy):
- Commit: `f4136ad` (mi push de hace 1 hora)
- Source: **git**
- State: READY · target: production
- Sus aliases:
```
"alias": [
  "agentes-medicos-executiveteam-oss-projects.vercel.app",
  "agentes-medicos-git-main-executiveteam-oss-projects.vercel.app"
]
```
**NO incluye omuwan.co ni www.omuwan.co.** El runtime de este deploy tiene **cero logs en la última hora** — confirmado vía `get_runtime_logs` con filtro por deploymentId.

Y el `project.latestDeployment` apunta al deploy nuevo, pero **el alias del dominio no se migra automáticamente** cuando un deploy fue creado vía CLI con aliases explícitos.

---

## 2. Problema B — Domain pinning a deploy viejo

### Por qué pasó

Alguien (el log dice `actor: claude`) corrió `vercel deploy --prod` el 16 abril desde local, fijando los aliases `omuwan.co` y `www.omuwan.co` a ese deploy específico. Vercel auto-rota el alias entre deploys solo si **todos los deploys son source=git** y nadie usa `vercel alias set`. Cuando un deploy se hace vía CLI con aliases manuales, esos aliases quedan **anclados** hasta que alguien los reasigne explícitamente.

### Qué se quedó sin llegar a producción para Lady

Cronología de fixes deployados pero NO en omuwan.co:

| Commit | Fecha | Fix |
|---|---|---|
| `bc8a39e` | mayo | EPS list centralizada |
| `f7ff682` | mayo | hallucinated appointment confirmations guard |
| `5f8e814` | mayo | calculate_date tool |
| `08887e59` | mayo | tilde sweep |
| `ab71e83` | **2026-06-02** | **identity confirmation hallucination guard (Lady reported)** |
| `155449e` | 2026-06-02 | types fix |
| `892a3ed` | 2026-06-02 | types optional |
| `3dfc17d` | 2026-06-03 | **Sub-fase A prepagada** |
| `f4136ad` | 2026-06-04 | **TZ fix lunes** |

Lady ha estado hablando con código del 16 abril. Mis "deploys verificados" eran 100% inútiles porque no servían tráfico. Esto invalida también el smoke test que dije hicimos para el TZ fix: corrió contra mi código local, no contra producción.

### Por qué el agente "respondía con bugs nuevos" hoy

El bug de identidad "como ya confirmaste" YA EXISTÍA en el código de abril (es bug de race condition + system prompt original). Mi fix de ese bug no llegó a Lady — sigue en su versión vieja con el bug original.

El bug TZ ("no atiende lunes") también existía desde abril.

El bug del precio Allianz $100,400 era de configuración (clasificación de convenios), no de código. Lady todavía no puede clasificar porque el dashboard nuevo con los botones rápidos también está en deploys-fantasma.

---

## 3. Problema A — HMAC rechazado

Esta investigación es contra el código del 16 abril (el que sirve tráfico). Si fixeamos B y promovemos un deploy nuevo, probablemente el código de HMAC sea idéntico (no toqué `verify-signature.ts`).

### Código que valida (idéntico abril ↔ hoy)

`src/lib/whatsapp/verify-signature.ts`:
```ts
export function verifyWebhookSignature(rawBody, signature, clinicAppSecret) {
  const globalSecret = process.env.WHATSAPP_APP_SECRET
  if (!globalSecret && !clinicAppSecret) {
    console.error('[Webhook] RECHAZADO: Ningún App Secret configurado')
    return false
  }
  const secrets = [globalSecret, clinicAppSecret].filter(Boolean)
  for (const secret of secrets) {
    if (verifyWithSecret(rawBody, signature, secret)) return true
  }
  return false
}
```

Y `route.ts` líneas 95-113:
```ts
let clinicAppSecret: string | null = null
const phoneNumberId = parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
if (phoneNumberId) {
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('whatsapp_app_secret')
    .eq('whatsapp_phone_id', phoneNumberId)
    .maybeSingle()
  clinicAppSecret = data?.whatsapp_app_secret ?? null
}
if (!verifyWebhookSignature(rawBody, signature, clinicAppSecret)) {
  return NextResponse.json({ error: 'Firma inválida' }, { status: 403 })
}
```

Algoritmo correcto: HMAC-SHA256 sobre `rawBody` con secret → compara con `sha256=<hex>` del header `X-Hub-Signature-256` usando `timingSafeEqual`. **No es bug de código**.

### Estado de credenciales en DB

Algia (query a `clinics`):

| Campo | Existe | Prefix |
|---|---|---|
| `whatsapp_phone_id` | ✅ | `99507751...` |
| `whatsapp_access_token` | ✅ | (encriptado, no preview) |
| `whatsapp_app_secret` | ✅ | `d7196a...` |
| `whatsapp_verify_token` | ✅ | `omuwan_9...` |

Por código, si el global `WHATSAPP_APP_SECRET` (env) está mal pero el per-clinic está bien, la validación pasa. Y viceversa. **Para que falle, AMBOS tienen que estar mal**.

### Lo que NO puedo verificar desde acá

- ❌ Valor actual de `WHATSAPP_APP_SECRET` en Vercel env vars (la MCP de Vercel no expone valores de env vars por seguridad).
- ❌ Valor actual del App Secret en Meta Business → app settings.
- ❌ Si alguien rotó el secret en Meta en las últimas horas (lo cual explicaría errores empezando 13:54 hoy cuando antes hoy mismo había mensajes recibidos OK — Lady chateó a las 12:43 y los msgs llegaron).

### Cronología sospechosa

- **12:43 COT hoy** — Lady "lunes" → agente respondió (logs muestran procesamiento OK)
- **13:54 COT** — HMAC errors empiezan
- **Entre 12:43 y 13:54** algo cambió. Si fue rotación de App Secret en Meta sin actualizar Vercel/DB, encaja.

---

## 4. Mapa de root causes propuestos

| # | Causa | Probabilidad | Cómo verificar | Quién |
|---|---|---|---|---|
| **B** | omuwan.co pinned a deploy abril | **CONFIRMADO** | Ya verificado via Vercel API | yo |
| A1 | Meta App Secret rotado, Vercel env stale | **ALTO** | Comparar `WHATSAPP_APP_SECRET` en Vercel dashboard vs Meta Business → Settings → App Secret | **vos** |
| A2 | Repo migration borró env vars | medio | Revisar fecha de última actualización de `WHATSAPP_APP_SECRET` en Vercel | **vos** |
| A3 | Per-clinic secret en DB stale | medio | Comparar `clinics.whatsapp_app_secret` con valor en Meta | **vos** |
| A4 | Body mutation antes de HMAC | descartado | Code review: `rawBody` se captura con `request.text()` ANTES de cualquier parse | descartado |
| A5 | Header `x-hub-signature-256` falta | descartado | Si faltara, el log diría "Falta header" — pero dice "inválida" | descartado |

---

## 5. Plan de fix (NO aplicado — necesita tu OK)

### Fix B — promover deploy actual a omuwan.co (URGENTE)

```bash
# desde local, autenticado en Vercel:
vercel alias set agentes-medicos-118elgkmj-executiveteam-oss-projects.vercel.app omuwan.co
vercel alias set agentes-medicos-118elgkmj-executiveteam-oss-projects.vercel.app www.omuwan.co

# o equivalente: en Vercel Dashboard → Project → Deployments → 
# "..." del deploy más reciente (f4136ad) → "Promote to Production"
```

Esto hace que todos mis fixes lleguen efectivamente a Lady. Si NO se hace, ningún parche nuevo importa.

Riesgos:
- 0 downtime (Vercel atómicamente cambia el alias)
- Si el fix HMAC depende del nuevo deploy, llega también
- **CRÍTICO**: si el deploy nuevo tiene un bug que no descubrimos por no llegar a prod, ahora se manifiesta. Mitigación: tener un rollback listo (`vercel alias set dpl_HPN2h49BFgPWEfGpFQWWwCuW7a8k omuwan.co`)

### Fix A — corregir credentials

Una vez B esté hecho, hay 3 caminos según qué descubras:

**Camino A1 (App Secret rotado)**:
1. Vercel Dashboard → Project → Settings → Environment Variables → editar `WHATSAPP_APP_SECRET` con valor actual de Meta
2. Redeploy o restart (Vercel propaga env vars al siguiente request en serverless)
3. Verificar log nuevo del próximo mensaje de Lady

**Camino A2 (per-clinic stale)**:
1. SQL `UPDATE clinics SET whatsapp_app_secret = '<new>' WHERE id = 'dac775fe-...'`
2. Sin redeploy, surte efecto inmediato

**Camino A3 (ambos rotos)**: hacer ambos.

### Para evitar repetición a futuro

- **Política**: no usar `vercel deploy --prod` manual. Usar siempre Git push para que la rotación de alias sea automática.
- **Monitor**: alerta cuando `omuwan.co` ≠ deploy más reciente.
- **Settings de Vercel**: revisar si "Production Branch" → `main` está correctamente configurado para auto-promote.

---

## 6. Lo que necesito de vos AHORA

Para cerrar el diagnóstico de A (HMAC), preciso 3 datos que solo vos podés sacar (yo no tengo acceso a Meta ni a env vars de Vercel):

1. **Meta Business → Settings → App Secret** — comparar primeros 6-8 chars con `d7196a...` (lo que está en DB para Algia).
2. **Vercel Dashboard → agentes-medicos → Settings → Environment Variables** — verificar:
   - ¿`WHATSAPP_APP_SECRET` existe en `Production` env?
   - ¿Su "Last updated" cuándo fue?
   - Su prefijo (los primeros 6-8 chars) ¿coincide con Meta?
3. Si tenés acceso al log completo de Vercel de una request rechazada, mirá el header `x-hub-signature-256` para confirmar que Meta SÍ está mandando firma (versus que el header esté ausente).

### Decisión que necesito de vos para arrancar el fix

- ¿Promovemos el deploy nuevo a omuwan.co **antes** de fixear HMAC? (mi recomendación: SÍ, porque expone el código real al diagnóstico)
- ¿O hacemos rollback formal a `dpl_HPN2h49BFgPWEfGpFQWWwCuW7a8k` como contingencia y debugeamos sobre código abril?

---

## 7. Estimación

| Fase | Tiempo |
|---|---|
| Fix B (alias) | 2 min — un comando `vercel alias set` |
| Verificar tráfico llega a deploy nuevo (1 mensaje de Lady) | 2 min |
| Fix A según camino (rotar env var + redeploy o UPDATE en DB) | 5–15 min |
| Smoke E2E con Lady | 5 min |
| **Total** | **15–25 min** una vez que tengas los datos de §6 |

---

## 8. Archivos sin tocar (Phase 1 estricto)

- `src/lib/whatsapp/verify-signature.ts` — verificado correcto, sin cambios
- `src/app/api/webhooks/whatsapp/route.ts` — verificado, sin cambios
- DB `clinics.whatsapp_app_secret` para Algia — sin cambios
- Vercel env vars — no toqué
- Vercel alias — no toqué

Listo para tu decisión sobre §6 y §5.
