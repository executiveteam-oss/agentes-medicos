-- ============================================================
-- SEED: Datos de prueba para desarrollo
-- Clínica dental en Medellín con 1 doctor, 2 pacientes, citas de ejemplo
-- ============================================================

-- 1. CLÍNICA DE PRUEBA
-- whatsapp_phone_id debe coincidir con WHATSAPP_PHONE_NUMBER_ID en .env.local
INSERT INTO clinics (
    id, name, slug, phone, whatsapp_phone_id,
    address, city, department, specialty,
    consultation_price, consultation_duration_minutes,
    faq, agent_name, agent_personality, welcome_message,
    subscription_status, trial_ends_at
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Clínica Dental Sonrisa',
    'clinica-dental-sonrisa',
    '+573001234567',
    '1025696970620733',
    'Calle 10 #43A-30, Consultorio 501',
    'Medellín',
    'Antioquia',
    'Odontología',
    80000,
    30,
    '[
        {"pregunta": "¿Qué servicios ofrecen?", "respuesta": "Ofrecemos limpieza dental, blanqueamiento, ortodoncia, endodoncia, implantes y odontología general."},
        {"pregunta": "¿Aceptan EPS?", "respuesta": "No manejamos EPS, somos consulta particular. Aceptamos efectivo, Nequi y transferencia bancaria."},
        {"pregunta": "¿Cuánto cuesta la consulta?", "respuesta": "La consulta de valoración tiene un costo de $80.000 COP."},
        {"pregunta": "¿Dónde están ubicados?", "respuesta": "Estamos en la Calle 10 #43A-30, Consultorio 501, en El Poblado, Medellín."},
        {"pregunta": "¿Tienen parqueadero?", "respuesta": "Sí, el edificio tiene parqueadero con tarifa de $5.000 por hora."},
        {"pregunta": "¿Atienden niños?", "respuesta": "Sí, atendemos pacientes desde los 3 años de edad."}
    ]',
    'María',
    'amable, cálida y profesional. Usa un tono cercano como si fuera una secretaria de confianza del consultorio',
    '¡Hola! 👋 Soy María, asistente virtual de la Clínica Dental Sonrisa. ¿En qué te puedo ayudar?',
    'trial',
    (NOW() + INTERVAL '14 days')
);

-- 2. DOCTOR
INSERT INTO doctors (
    id, clinic_id, name, specialty, phone, email, is_active,
    working_hours
) VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'Dr. Carlos Gómez',
    'Odontología General',
    '+573009876543',
    'carlos@clinicasonrisa.com',
    true,
    '{
        "monday":    {"start": "08:00", "end": "18:00", "active": true},
        "tuesday":   {"start": "08:00", "end": "18:00", "active": true},
        "wednesday": {"start": "08:00", "end": "18:00", "active": true},
        "thursday":  {"start": "08:00", "end": "18:00", "active": true},
        "friday":    {"start": "08:00", "end": "16:00", "active": true},
        "saturday":  {"start": "09:00", "end": "13:00", "active": true},
        "sunday":    {"start": "00:00", "end": "00:00", "active": false}
    }'
);

-- 3. PACIENTES DE PRUEBA
-- Paciente 1: Ana (ya tiene consentimiento de datos)
INSERT INTO patients (
    id, clinic_id, name, phone, email,
    document_type, document_number, eps,
    total_appointments, data_consent_at
) VALUES (
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'Ana López',
    '+573101112233',
    'ana.lopez@email.com',
    'CC',
    '1234567890',
    'Particular',
    2,
    NOW()
);

-- Paciente 2: Pedro (paciente nuevo, sin consentimiento aún)
INSERT INTO patients (
    id, clinic_id, name, phone, email,
    document_type, document_number,
    total_appointments
) VALUES (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    'Pedro Martínez',
    '+573202223344',
    NULL,
    'CC',
    '0987654321',
    1
);

-- 4. CITAS DE PRUEBA
-- Cita 1: Ana — HOY a las 10:00 AM COT (15:00 UTC)
INSERT INTO appointments (
    id, clinic_id, doctor_id, patient_id,
    starts_at, ends_at, status, reason, source
) VALUES (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    (CURRENT_DATE + TIME '15:00:00') AT TIME ZONE 'UTC',
    (CURRENT_DATE + TIME '15:30:00') AT TIME ZONE 'UTC',
    'confirmed',
    'Limpieza dental',
    'whatsapp_agent'
);

-- Cita 2: Ana — MAÑANA a las 2:00 PM COT (19:00 UTC)
INSERT INTO appointments (
    id, clinic_id, doctor_id, patient_id,
    starts_at, ends_at, status, reason, source
) VALUES (
    '66666666-6666-6666-6666-666666666666',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    (CURRENT_DATE + INTERVAL '1 day' + TIME '19:00:00') AT TIME ZONE 'UTC',
    (CURRENT_DATE + INTERVAL '1 day' + TIME '19:30:00') AT TIME ZONE 'UTC',
    'confirmed',
    'Control de ortodoncia',
    'dashboard'
);

-- Cita 3: Pedro — MAÑANA a las 9:00 AM COT (14:00 UTC)
INSERT INTO appointments (
    id, clinic_id, doctor_id, patient_id,
    starts_at, ends_at, status, reason, source
) VALUES (
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '44444444-4444-4444-4444-444444444444',
    (CURRENT_DATE + INTERVAL '1 day' + TIME '14:00:00') AT TIME ZONE 'UTC',
    (CURRENT_DATE + INTERVAL '1 day' + TIME '14:30:00') AT TIME ZONE 'UTC',
    'confirmed',
    'Dolor de muela',
    'whatsapp_agent'
);

-- Cita 4: Ana — Cita pasada (hace 3 días, completada)
INSERT INTO appointments (
    id, clinic_id, doctor_id, patient_id,
    starts_at, ends_at, status, reason, source
) VALUES (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    (CURRENT_DATE - INTERVAL '3 days' + TIME '16:00:00') AT TIME ZONE 'UTC',
    (CURRENT_DATE - INTERVAL '3 days' + TIME '16:30:00') AT TIME ZONE 'UTC',
    'completed',
    'Valoración inicial',
    'manual'
);

-- 5. CONVERSACIÓN DE PRUEBA (Ana ya ha hablado con el agente)
INSERT INTO conversations (
    id, clinic_id, patient_id, whatsapp_phone, status
) VALUES (
    '99999999-9999-9999-9999-999999999999',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    '+573101112233',
    'active'
);

-- 6. MENSAJES DE PRUEBA (historial breve)
INSERT INTO messages (conversation_id, role, content) VALUES
    ('99999999-9999-9999-9999-999999999999', 'patient', 'Hola, quiero agendar una cita'),
    ('99999999-9999-9999-9999-999999999999', 'agent', '¡Hola Ana! 👋 Con gusto te ayudo a agendar tu cita. ¿Para cuándo te gustaría?'),
    ('99999999-9999-9999-9999-999999999999', 'patient', 'Mañana en la tarde si se puede'),
    ('99999999-9999-9999-9999-999999999999', 'agent', '¡Perfecto! Mañana tenemos disponible a las 2:00 PM con el Dr. Carlos Gómez. ¿Te sirve?'),
    ('99999999-9999-9999-9999-999999999999', 'patient', 'Sí, dale'),
    ('99999999-9999-9999-9999-999999999999', 'agent', '✅ Cita agendada:
📅 Mañana
🕐 2:00 PM
👨‍⚕️ Dr. Carlos Gómez
📍 Calle 10 #43A-30, Consultorio 501

Si necesitas cambiar algo, escríbeme. ¡Nos vemos!');
