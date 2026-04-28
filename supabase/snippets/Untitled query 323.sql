SELECT * FROM chatbot_conversations ORDER BY started_at DESC LIMIT 5;
SELECT kb_file, COUNT(*) FROM chatbot_topics_used GROUP BY kb_file ORDER BY count DESC;