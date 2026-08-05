# Omuwan — Comercial

> Posicionamiento, propuesta de valor y planes. **No es guía de código** — vive acá para no
> mezclarse con `CLAUDE.md`, que es solo invariantes del sistema.
>
> Origen: material de la etapa de ideación, movido desde `CLAUDE.md` sin editar los números.
> Revisar antes de usarlo en una propuesta real.

---

## Propuesta de valor

> **"Tu consultorio atendiendo 24/7 por WhatsApp, sin contratar más personal."**

SaaS B2B: agente de IA por WhatsApp para consultorios médicos pequeños en Colombia (1-3
médicos). Reemplaza tareas de secretaria: agenda citas, responde preguntas frecuentes, envía
recordatorios, reduce no-shows. Cobro: **setup inicial + suscripción mensual**.

## El problema que resuelve

1. La secretaria o el médico pasan horas respondiendo WhatsApp para agendar citas.
2. No-shows del 20-35% = dinero perdido.
3. Nadie responde fuera de horario → se pierden pacientes.
4. *"¿Cuánto cuesta?"*, *"¿Dónde queda?"* se responde 30+ veces al día.
5. Gestión en Excel, papel o un HIS sin automatización.

---

## 💰 Planes y precios

| | Basic | Pro |
|---|---|---|
| Setup (único) | $200.000 COP | $400.000 COP |
| Mensualidad | $150.000 COP | $300.000 COP |
| Doctores | 1 | Hasta 3 |
| Conversaciones/mes | 500 | 2.000 |
| Recordatorios | ✅ | ✅ |
| FAQ personalizadas | 10 | Ilimitadas |
| Dashboard | Básico | Completo + analytics |

**Costo operativo por clínica:** ~$10-50 USD/mes → margen saludable.

> ⚠️ Ese costo operativo es una **estimación de la etapa de ideación**, anterior a medir el
> consumo real del agente en producción. El costo por conversación depende del tamaño del
> contexto que se le inyecta al modelo (que creció bastante con las reglas por tipo de consulta)
> y del prompt caching. Antes de cerrar un precio nuevo, medirlo contra el consumo real —
> `api_usage` y el A/B de modelos en `scripts/battery-*.md`.

---

## Nombres considerados para el producto

De la etapa de ideación, antes de quedar en **Omuwan**:

- **Sekre** — referencia a "secretaria", memorable
- **AgenDA Med** — Agente + Agenda + Med
- **Clio Salud** — profesional y humano
- **MediBot.co** — directo, dominio .co

---

*Material comercial. Lo técnico está en `CLAUDE.md`; el contexto de cada cliente, en
`docs/CLIENTE_<NOMBRE>.md`.*
