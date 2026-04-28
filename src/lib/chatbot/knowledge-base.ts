// ============================================================
// Knowledge base loader for help chatbot
// Loads docs/help/*.md at module init, caches in memory.
// Filters by user permissions at request time.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { Permissions } from '@/types/permissions'

export interface KBArticle {
  filename: string
  title: string
  description: string
  routes: string[]
  requiredPermissions: string[] // e.g. ["whatsapp.write", "users.read"]
  content: string
}

// Module-level cache — loaded once per lambda instance
let articles: KBArticle[] | null = null

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }

  const metaBlock = match[1]
  const content = match[2].trim()
  const meta: Record<string, unknown> = {}

  for (const line of metaBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    // Parse YAML arrays: ["a", "b"]
    if (typeof value === 'string' && value.startsWith('[')) {
      try {
        value = JSON.parse(value.replace(/'/g, '"'))
      } catch {
        // leave as string
      }
    }
    // Remove quotes
    if (typeof value === 'string') {
      value = value.replace(/^["']|["']$/g, '')
    }
    meta[key] = value
  }

  return { meta, content }
}

function loadArticles(): KBArticle[] {
  const helpDir = path.join(process.cwd(), 'docs', 'help')

  if (!fs.existsSync(helpDir)) {
    console.warn('[Chatbot KB] docs/help/ directory not found')
    return []
  }

  const files = fs.readdirSync(helpDir).filter((f) => f.endsWith('.md')).sort()
  const loaded: KBArticle[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(helpDir, file), 'utf-8')
      const { meta, content } = parseFrontmatter(raw)

      loaded.push({
        filename: file,
        title: (meta.title as string) ?? file.replace('.md', ''),
        description: (meta.description as string) ?? '',
        routes: (meta.routes as string[]) ?? [],
        requiredPermissions: (meta.required_permissions as string[]) ?? [],
        content,
      })
    } catch (err) {
      console.error(`[Chatbot KB] Failed to load ${file}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`[Chatbot KB] Loaded ${loaded.length} articles from docs/help/`)
  return loaded
}

/** Get all articles (cached in module) */
export function getAllArticles(): KBArticle[] {
  if (!articles) {
    articles = loadArticles()
  }
  return articles
}

/** Filter articles by user permissions */
export function getArticlesForUser(permissions: Permissions): KBArticle[] {
  const all = getAllArticles()

  return all.filter((article) => {
    if (article.requiredPermissions.length === 0) return true

    return article.requiredPermissions.every((perm) => {
      const [module, level] = perm.split('.')
      const modulePerm = permissions[module as keyof Permissions]
      if (!modulePerm) return false
      if (level === 'write') return modulePerm.write
      if (level === 'read') return modulePerm.read
      return modulePerm.read // default to read
    })
  })
}

/** Build the <docs> block for the system prompt */
export function buildKBBlock(userPermissions: Permissions): string {
  const filtered = getArticlesForUser(userPermissions)

  if (filtered.length === 0) {
    return '<docs>\nNo hay documentacion disponible para tu rol.\n</docs>'
  }

  const sections = filtered.map((a) => {
    const routesLine = a.routes.length > 0 ? `Rutas: ${a.routes.join(', ')}` : ''
    return `## ${a.title}\n${a.description}\n${routesLine}\n\n${a.content}`
  })

  return `<docs>\n${sections.join('\n\n---\n\n')}\n</docs>`
}
