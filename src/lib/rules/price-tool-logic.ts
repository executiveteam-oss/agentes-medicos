// Lógica pura del tool de precio (B1). La REGLA vive acá, no en el prompt.
// Regla de oro: solo el modo EXACTO 'particular' habilita un precio. Nunca se
// cae a particular por defecto. EPS/prepagada NUNCA reciben tarifa.
import { formatCOP } from '@/lib/utils/dates'

export type PaymentMode = 'particular' | 'eps' | 'prepagada' | 'unknown'

export function normalizePaymentMode(raw: string | null | undefined): PaymentMode {
  if (!raw) return 'unknown'
  const n = raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/\s+/g, ' ')
    .trim()
  if (n === 'particular') return 'particular'          // SOLO exacto habilita precio
  if (n.includes('eps')) return 'eps'
  if (n.includes('prepagada')) return 'prepagada'
  return 'unknown'                                      // default seguro: preguntar
}

export interface PriceCtInput { name: string; price: number | null; eps_name: string | null }

export type PriceDecision =
  | { action: 'ask_mode'; message: string }
  | { action: 'convenio_copago_eps'; message: string }
  | { action: 'convenio_copago_prepagada'; message: string }
  | { action: 'no_particular_price'; message: string }
  | { action: 'quote_particular'; message: string; price: number }

const MSG_ASK = 'Para decirte el valor necesito saber cómo vas a pagar: ¿particular, EPS o medicina prepagada?'
const MSG_EPS = 'Con tu EPS, lo que pagas es un copago que depende de tu plan; el equipo del consultorio te lo confirma al agendar tu cita.'
const MSG_PREPAGADA = 'Con tu medicina prepagada, lo que pagas depende de tu plan y de la autorización; el equipo del consultorio te lo confirma al agendar tu cita.'
const MSG_NO_PARTICULAR = 'Ese valor lo confirma el equipo del consultorio; ¿quieres que te agende?'

export function decidePriceResponse(ct: PriceCtInput, mode: PaymentMode): PriceDecision {
  if (mode === 'unknown') return { action: 'ask_mode', message: MSG_ASK }
  if (mode === 'eps') return { action: 'convenio_copago_eps', message: MSG_EPS }
  if (mode === 'prepagada') return { action: 'convenio_copago_prepagada', message: MSG_PREPAGADA }
  if (mode === 'particular') {
    // Segunda red: si el CT es de convenio, NUNCA devolver su tarifa aunque digan particular.
    if (ct.eps_name != null) return { action: 'no_particular_price', message: MSG_NO_PARTICULAR }
    if (ct.price == null) return { action: 'no_particular_price', message: MSG_NO_PARTICULAR }
    return { action: 'quote_particular', price: ct.price, message: `El valor particular de ${ct.name} es ${formatCOP(ct.price)}.` }
  }
  // FINAL default: cualquier otro valor (garbage mode) nunca debe citar un precio particular
  return { action: 'ask_mode', message: MSG_ASK }
}
