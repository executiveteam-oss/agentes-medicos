// ============================================================
// iSalud Adapter — Types only (scraping runs in GitHub Actions)
//
// The actual scraping code is in scripts/isalud-scraper.ts
// This file only exports types used by sync-agent.ts
// ============================================================

// These types are defined inline in sync-agent.ts now.
// This file kept for import compatibility if needed.

export interface ISaludCredentials {
  subdomain: string
  username: string
  password: string
}
