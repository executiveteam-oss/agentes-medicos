# Omuwan — Product Summary

> Last updated: March 2026

---

## 1. What is Omuwan?

Omuwan is a B2B SaaS platform for small medical clinics in Colombia (1-3 doctors). It provides an AI-powered WhatsApp agent that acts as a virtual secretary — booking appointments, answering FAQs, sending reminders, and reducing no-shows — paired with a full-featured web dashboard for clinic management. The platform handles everything from agenda management and billing to patient retention and EPS invoicing, all while complying with Colombian healthcare regulations (Ley 1581/2012). Clinics get 24/7 WhatsApp coverage without hiring additional staff, and doctors get a daily briefing with their schedule and risk indicators.

---

## 2. Full Feature List

### WhatsApp Agent

**Core Capabilities (6 Tools)**
- **Check availability** — Shows open slots for a specific doctor/date, respects booking rules (min/max advance), handles multi-doctor clinics, supports consultation types with different durations
- **Create appointment** — Books after explicit patient confirmation, auto-creates new patients, collects name/birthdate/document/EPS/address/email, generates virtual meeting links, syncs to Google Sheets and external HIS
- **Get patient appointments** — Lists future confirmed/rescheduled citas for a patient
- **Cancel appointment** — Cancels with reason tracking, auto-notifies next person on waitlist about freed slot
- **Reschedule appointment** — Moves to new date/time, preserves payment type and consultation type, notifies waitlist for freed original slot
- **Add to waitlist** — Registers patient when no slots available, supports preferred dates/times and schedule notes for manual-availability doctors
- **Escalate to human** — Passes to clinic staff with urgency levels (low/medium/high/emergency)

**Conversational Intelligence**
- Dynamic system prompt built per-clinic with real data (prices, hours, doctors, FAQs, consultation types)
- Recurring patient recognition — greets by name, skips data collection if data on file
- Colombian Spanish tone: informal (tuteo), short (3-4 lines), moderate emojis, no markdown
- Emergency detection — "Llama al 123" for medical emergencies, "Llama al 106" for suicidal ideation
- Auto-escalation keywords: urgencia, dolor, emergencia, sangrado, etc.
- Multi-doctor handling: asks patient to choose doctor
- Manual-availability doctors: collects preferences, adds to waitlist instead of showing slots
- Closed agenda / vacation handling: shows vacation message, offers waitlist
- Consultation type awareness: preparation warnings, document requirements, virtual/presencial options

**Privacy & Compliance**
- Automatic privacy notice (Ley 1581/2012) on first contact with new patients
- Data consent timestamp tracked per patient
- Never shares patient data between patients
- Never provides medical diagnoses or drug recommendations

---

### Dashboard Modules

**Agenda** (`/dashboard`)
- Day / Week / Month calendar view with appointment cards
- Real-time stats: today's appointments, completed vs daily goal, no-show rate
- Doctor tabs for multi-doctor clinics
- New appointment modal (admin/coordinator only)
- Colombian holiday alerts (next 3 days)
- Patient risk indicators (no-show probability, history)
- Virtual consultation indicators (modality, link, documents status)
- Appointment statuses: confirmed, rescheduled, completed, no_show

**No-Shows** (`/dashboard/noshow`)
- No-show rate metrics (last 30 days): count, percentage, estimated cost lost in COP
- Alert if rate exceeds 25% threshold
- Charts: no-shows by day of week, rate per day
- High-risk patient table (top 10): name, no-show count, rate, last no-show date
- Color-coded severity: red >40%, amber >20%, green <20%

**Cartera (Accounts Receivable)** (`/dashboard/cartera`)
- Total debt pending, overdue (>30 days), unique debtors
- Patient debt entries with days overdue, amount, payment type, status
- Collection actions: WhatsApp message and email to patient
- Aging analysis by days overdue

**Facturacion (Billing)** (`/dashboard/facturacion`)
- Pending invoices: completed appointments without invoice number (today + yesterday)
- Invoiced items this month: merged from appointments + standalone invoices table
- Invoice status tracking: pendiente, emitida, en_tramite, pagada, glosada, vencida
- EPS Glosas section: active glosas, urgent glosas, risk dashboard
- Register and manage glosas inline

**Lista de Espera (Waitlist)** (`/dashboard/espera`)
- Two lists: system waitlist entries + WhatsApp manual requests
- Per entry: patient, preferred dates/times, priority, doctor, consultation type, status
- Priority scoring algorithm with available slots this week
- Auto-notification when slot frees up (via cancellation)

**Pacientes (Patients)** (`/dashboard/patients`)
- Directory with search/filter (client-side), up to 500 patients
- Columns: name, phone, EPS, total appointments, no-show count

**Patient Detail** (`/dashboard/patients/[id]`)
- Stats: total appointments, no-show rate, pending cartera balance, patient since date
- Personal info: document, birthdate, email, EPS, doctor notes
- Reactivation banner with visit frequency and days since last visit
- Appointment history table with status, payment type, invoice status, documents status
- WhatsApp conversations list with message count and status
- Cartera entries per patient

**Conversaciones** (`/dashboard/conversations`)
- Conversation list: patient, status (active/escalated/resolved), last message preview, count
- Status filters with counts
- Detail view: full message thread (patient/agent/staff), write capability for staff takeover

**Asistente IA** (`/dashboard/asistente`)
- Internal chat for staff to query the AI: "How many appointments today?", "What's the no-show rate?", "Who's on the waitlist?"
- Action confirmation flow: AI proposes actions, staff must confirm before execution

**WhatsApp Status** (`/dashboard/whatsapp`)
- Connection status (green if connected, amber if not configured)
- Active conversations today with patient name, last message, count
- Agent configuration: doctor assignment, vacation message

**Estadisticas (Analytics)** (`/dashboard/analytics`)
- **Losses this month**: no-shows, cancellations, unbilled — each with COP amount and count
- **6-month trend chart**: real vs potential revenue (gap = losses)
- **This week**: completed/scheduled, revenue, no-shows, worst time slot
- **Month comparison**: citas, revenue, no-show rate — each with delta vs previous month
- **Charts**: day-of-week occupancy, time slot demand (morning/afternoon), revenue by payment type
- **Patient lists**: top loyal, top no-show, top debtors — linked to patient detail
- **New patients**: this month vs previous month
- **Automations**: NPS average (color-coded), inactive patients (>90 days), reactivated this month
- **Retention**: recurring patients, return rate, at-risk patients with reactivation button
- **EPS profitability**: facturado vs cobrado vs glosado chart (6 months)
- **Financial alerts**: cartera vencida, revenue projection, EPS invoices >30 days with detail table

**Vacation Planning** (`/dashboard/analytics/vacaciones`)
- Week-by-week historical demand analysis
- Ranked suggestions for lowest-demand weeks
- Vacation message configuration

**Legal** (`/dashboard/legal`)
- 6 Colombian laws/resolutions explained: Ley 1581/2012, Res. 1995/1999, Ley 23/1981, Dec. 4747/2007, Ley 2015/2020, Art. 15 Constitucional
- Per law: requirements + how Omuwan complies
- Clinic responsibilities checklist

---

### Settings and Configuration

**Consultorio** (`/dashboard/settings/clinic`)
- General: name, specialties (multi-select), phone, email, website, logo URL
- Consultation: price (COP), daily appointment goal
- Booking rules: minimum advance (0-168h), maximum advance (15-90 days)
- Virtual consultations: toggle, platform (Google Meet/Zoom/Teams/custom/iSalud), base URL, patient instructions
- Location: address, city, department, building, floor, office — with live preview

**WhatsApp Setup** (`/dashboard/settings/whatsapp`)
- 6-step wizard: Meta Business Account setup, app creation, phone number connection, permanent token generation, credential entry (Phone Number ID, Business Account ID, Access Token), webhook configuration with verify token

**Integraciones** (`/dashboard/settings/integrations`)
- HIS software selector: Asdrual Gutierrez, Medilink, AxisMed, Huli, Isalud, Otro, Ninguno
- Integration request form with contact info — sends email to support team
- Dynamic credential configuration per software type
- Test connection button with status feedback
- Google Sheets: email input for account linking, connection status, link to sheet
- Coming soon: online payments (Wompi/PayU), email confirmations

**Usuarios** (`/dashboard/settings/users`)
- User list with roles and linked doctor
- Invite form: email, role selector, doctor selector (for Doctor role)
- Edit, delete, change role actions

**Roles y Permisos** (`/dashboard/settings/roles`)
- 5 predefined roles: Admin, Doctor, Coordinadora, Secretaria, Contador
- 13 permission modules x read/write matrix editor
- Custom role creation

**Notificaciones** (`/dashboard/settings/notifications`)
- Toggles: 24h reminder, 2h reminder, morning report (with time picker), no-show alert (with threshold), overdue billing alert (with days threshold)

---

### Automation Features

| Automation | Schedule | Description |
|---|---|---|
| **24h Appointment Reminder** | Daily 6:00 AM COT | WhatsApp message with date/time/doctor/location, asks "Confirm? Si/No" |
| **12h Auto-Unconfirmed** | Same cron | Marks unresponsive patients as unconfirmed, recalculates no-show probability (+30% penalty) |
| **48h Document Reminder** | Same cron | Reminds patients with documents pending for their upcoming appointment |
| **30min Virtual Link** | Same cron | Sends video meeting link + instructions for virtual consultations starting in ~30 min |
| **Morning Report** | Daily 6:00 AM COT | WhatsApp + email to each doctor: today's schedule with confirmation status, no-show risk indicators, document pending count, manual booking requests, overbooking recommendation |
| **Post-Consulta NPS** | Daily 9:00 AM COT | WhatsApp follow-up 24h after completed appointment: "Del 1 al 10, how was your experience?" — captures score in DB |
| **Patient Reactivation** | Weekly Monday 10:00 AM COT | Messages inactive patients (>2x visit frequency or >90 days) with personalized win-back message, prevents re-messaging for 30 days |
| **Auto-Reopen Agendas** | Daily 5:00 AM COT | Reopens doctor agendas when vacation end date is reached |
| **Waitlist Auto-Notify** | On cancellation/reschedule | Sends WhatsApp to first waitlisted patient when a slot frees up |
| **No-Show Probability** | After reminders | Recalculates probability based on history, confirmation status, and behavior patterns |
| **Google Sheets Sync** | After every appointment change | Real-time export of appointments, patients, finances, no-show stats |
| **HIS Sync** | After create/cancel/reschedule | Fire-and-forget sync to external clinical systems (never blocks main flow) |

---

### Security and Legal Compliance

- **Ley 1581/2012** — Automatic privacy notice on first contact, data_consent_at tracking, ARCO rights support
- **Multi-tenant isolation** — Every database query filtered by clinic_id, RLS policies enforced at DB level
- **Role-based access control** — 13 modules x read/write permissions, 5 predefined roles
- **Doctor-level data isolation** — Doctors only see their own appointments, patients, and stats
- **Webhook security** — HMAC signature verification (X-Hub-Signature-256) on all WhatsApp webhooks
- **Rate limiting** — IP-based general limit + 30 req/min per patient phone
- **Credential security** — WhatsApp tokens and HIS credentials stored encrypted, masked in API responses
- **Audit logging** — All critical actions recorded: appointment changes, escalations, integrations, login events
- **Input sanitization** — Patient messages sanitized before LLM processing
- **No sensitive logging** — Phone numbers truncated, documents hidden in logs

---

### Integration Capabilities

**WhatsApp Business Cloud API (Meta)**
- Full webhook integration (receive + send messages)
- Template messages for proactive outreach (reminders, NPS, reactivation)
- Blue checkmark read receipts
- Media handling (documents for appointments)

**Google Sheets**
- Real-time bidirectional sync: appointments, patients, finances, no-show stats
- Auto-creates sheet from clinic template
- Linked via clinic's Google account email

**External HIS Systems** (Generic Connector Architecture)
- Interface: createAppointment, cancelAppointment, getVirtualLink, syncPatient, testConnection
- Registered connectors: Isalud, Asdrual Gutierrez, Medilink (placeholder implementations)
- Dynamic credential configuration per software
- Fire-and-forget sync hooks — never block main appointment flow
- external_his_id stored per appointment for bidirectional reference

**Email (Resend)**
- Collection emails to patients with outstanding balances
- Morning report HTML email to doctors
- Integration request emails to support team
- Silent fallback when not configured

---

## 3. Technical Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 16 (App Router) + TypeScript |
| Hosting | Vercel (serverless) |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| AI | Claude API (Anthropic) — claude-sonnet for conversations |
| Messaging | WhatsApp Business Cloud API (Meta) |
| Email | Resend |
| UI | Tailwind CSS + custom component system |
| Validation | Zod |
| Dates | date-fns + date-fns-tz (America/Bogota) |
| Cron | Vercel Cron Functions |
| Integrations | Google Sheets API, HIS connector framework |

---

## 4. Database Schema Overview

| Table | Purpose |
|---|---|
| **clinics** | Tenant root — name, config, WhatsApp credentials, subscription, working hours, FAQ, virtual config, integrations, notification settings |
| **doctors** | Doctor profiles — specialty, schedule, agenda status (open/closed/vacation), schedule type (fixed/manual) |
| **patients** | Patient directory — contact info, document (CC/TI/CE/PP), EPS, no-show stats, visit frequency, reactivation tracking, data consent |
| **appointments** | Core entity — start/end times, status, payment type, invoice status, EPS fields, NPS score, modality, virtual link, documents, glosa tracking, external HIS ID |
| **conversations** | WhatsApp chat sessions — status (active/escalated/resolved), linked to patient |
| **messages** | Individual messages — role (patient/agent/staff), content, WhatsApp message ID |
| **reminders** | Scheduled reminders — type (24h/2h), send status, patient response |
| **waitlist** | Queue entries — preferred dates/times, priority, doctor, status, auto-notification tracking |
| **consultation_types** | Per-doctor service catalog — name, duration, price, preparation requirements, document requirements, modality, WhatsApp bookability |
| **cartera** | Accounts receivable — amount, days overdue, collection attempts, status |
| **invoices** | Standalone invoices (separate from appointment invoicing) |
| **clinic_roles** | Role definitions with permission matrices (13 modules x read/write) |
| **clinic_users** | User-clinic linkage — auth user, role, linked doctor ID |
| **audit_log** | Action history — actor type/ID, target, details JSON |

32 migrations tracking the full schema evolution.

---

## 5. User Roles

| Role | Access | Notes |
|---|---|---|
| **Admin** | Full read/write on all 13 modules | Can manage users, roles, billing, integrations, WhatsApp setup |
| **Coordinadora** (default) | Full: agenda, no-shows, waitlist, patients, AI assistant, WhatsApp. Read-only: conversations, analytics | Primary operational role |
| **Doctor** | Read: agenda (own only), patients (own only), no-shows (own), analytics (own stats). Write: agenda, no-shows | Data isolated to their own appointments. Cannot see cartera, facturacion, WhatsApp config, waitlist, conversations. Settings limited to Consultorio tab |
| **Secretaria** | Full: agenda. Read-only: waitlist, patients | Minimal access for front-desk staff |
| **Contador** | Full: cartera, facturacion. Read-only: analytics | Financial access only |

Doctor role with unlinked doctor_id shows a "Contact admin" banner instead of dashboard content.

---

## 6. Onboarding Flow

A new client goes through a 4-step wizard after registration:

1. **Register** — Clinic name + specialties (from 20+ predefined Colombian specialties), user's name + email + password
2. **Step 1: Clinic Data** — Address, city, phone, consultation price (COP), appointment duration
3. **Step 2: Team Invitations** — Invite team members by email with role assignment (optional, can be done later)
4. **Step 3: WhatsApp Setup** — Enter Phone Number ID + Access Token (optional, can be skipped and configured later in Settings)
5. **Step 4: Done** — Summary with next steps checklist, marks `onboarded_at` timestamp, redirects to dashboard

Behind the scenes, registration auto-creates:
- Clinic record with 14-day trial on Basic plan
- 5 predefined roles (Admin, Doctor, Coordinadora, Secretaria, Contador)
- Admin user linked to the registrant

---

## 7. Coming Soon / Not Yet Implemented

| Feature | Status | Notes |
|---|---|---|
| **Online payments (Wompi/PayU)** | Coming soon | UI placeholder in Settings > Integrations. Pay links via WhatsApp |
| **Email confirmations to patients** | Coming soon | UI placeholder in Settings > Integrations |
| **HIS connector implementations** | Placeholder | Isalud, Asdrual, Medilink connectors exist but throw `IntegrationNotImplementedError`. Awaiting API documentation from each vendor |
| **2h reminders** | Toggle exists | Cron only sends 24h reminders currently; 2h is in notification settings but not in cron |
| **Subscription billing** | Schema exists | subscription_status/plan/trial_ends_at columns in clinics table, but no Wompi integration or enforcement |
| **Landing page + pricing** | Partial | `/` page exists but may not be production-ready |
| **CSV export** | Not implemented | Mentioned in roadmap for iSalud migration |
| **Mobile app** | Not implemented | Roadmap Phase 5 |
| **Voice agent** | Not implemented | Roadmap Phase 5 |
| **Multi-clinic per user** | Not implemented | Current model: 1 user = 1 clinic |

---

*Built for Colombian healthcare. Powered by Claude AI.*
