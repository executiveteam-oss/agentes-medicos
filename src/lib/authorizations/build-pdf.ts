// ============================================================
// Ensambla la descarga de una autorización.
//
// - Imágenes JPEG/PNG → una página cada una (tamaño natural).
// - PDF → se copian sus páginas tal cual (merge).
// - Acepta VARIOS archivos → un solo PDF multi-página (para la multi-selección
//   futura; hoy la UI manda uno). Orden = el que reciba.
// - WEBP/HEIC/HEIF: pdf-lib no los embebe. Si es el ÚNICO archivo → fallback:
//   se devuelve el original con su extensión (la secretaria lo convierte; un
//   archivo bien nombrado es mejor que un error). En un lote con otros
//   convertibles, se saltan (skipped).
//
// Sin `sharp` a propósito: WhatsApp entrega JPEG en la enorme mayoría, y evitar
// la dependencia nativa pesada mantiene el bundle liviano. Si más adelante el
// fallback de HEIC se vuelve común (dato real), se agrega sharp acá sin tocar
// el resto.
// ============================================================

import { PDFDocument } from 'pdf-lib'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

export interface MediaFile {
  bytes: Uint8Array
  mimeType: string
}

export type AssembleResult =
  | { kind: 'pdf'; bytes: Uint8Array; pages: number; skipped: number }
  | { kind: 'raw'; bytes: Uint8Array; mimeType: string; ext: string }

function isConvertible(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/png' || mime === 'application/pdf'
}

export async function assembleAuthorizationPdf(files: MediaFile[]): Promise<AssembleResult> {
  const convertible = files.filter((f) => isConvertible(f.mimeType))

  // Ninguno convertible (ej. una sola imagen HEIC/WEBP) → fallback al original.
  if (convertible.length === 0) {
    const f = files[0]
    return { kind: 'raw', bytes: f.bytes, mimeType: f.mimeType, ext: MIME_EXT[f.mimeType] ?? 'bin' }
  }

  const out = await PDFDocument.create()
  for (const f of files) {
    if (f.mimeType === 'application/pdf') {
      const src = await PDFDocument.load(f.bytes)
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    } else if (f.mimeType === 'image/jpeg' || f.mimeType === 'image/png') {
      const img = f.mimeType === 'image/jpeg' ? await out.embedJpg(f.bytes) : await out.embedPng(f.bytes)
      const page = out.addPage([img.width, img.height])
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    }
    // no convertible dentro de un lote → se salta
  }

  const bytes = await out.save()
  return { kind: 'pdf', bytes, pages: out.getPageCount(), skipped: files.length - convertible.length }
}
