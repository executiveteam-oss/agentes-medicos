-- ============================================================
-- Migration 00063: Help chatbot telemetry
-- Tracks conversations and KB topic usage for learning loop
-- ============================================================

CREATE TABLE chatbot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INT DEFAULT 0,
  navigate_to_calls INT DEFAULT 0
);

CREATE INDEX idx_chatbot_conv_clinic ON chatbot_conversations(clinic_id);
CREATE INDEX idx_chatbot_conv_user ON chatbot_conversations(user_id);

ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chatbot_insert_own" ON chatbot_conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "chatbot_update_own" ON chatbot_conversations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Topics used per conversation (for learning loop)
CREATE TABLE chatbot_topics_used (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  kb_file TEXT NOT NULL,
  was_helpful BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chatbot_topics_kb_file ON chatbot_topics_used(kb_file);
CREATE INDEX idx_chatbot_topics_conversation ON chatbot_topics_used(conversation_id);

ALTER TABLE chatbot_topics_used ENABLE ROW LEVEL SECURITY;

-- Only service role can insert topics (from endpoint)
-- Super admin can SELECT for analytics (no frontend access)
