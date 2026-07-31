-- ============================================================
-- Estado de entrega de mensajes salientes. Hasta ahora un mensaje del agente se
-- guardaba igual esté o no entregado → conversaciones fantasma (la secretaria
-- cree que salió). delivery_status='failed' + motivo en lenguaje claro.
-- NULL = normal (asumido enviado). Solo aplica a salientes (agent/staff).
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status text;   -- NULL | 'failed'
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error text;    -- motivo en español, sin código
