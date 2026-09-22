import caveat500 from '@fontsource/caveat/files/caveat-latin-500-normal.woff2?url'
import caveat700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url'

/**
 * Rasterize the log-sheet SVGs and put one per Letter page in a PDF.
 *
 * An SVG drawn into <img>/canvas cannot see the page's web fonts, so the "pen" font is
 * inlined as base64 @font-face before rendering. The printed-form text uses system
 * Helvetica/Arial, which canvas can already reach.
 */
let fontCss: Promise<string> | null = null

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

function embeddedFontCss(): Promise<string> {
  fontCss ??= Promise.all([toDataUrl(caveat500), toDataUrl(caveat700)]).then(
    ([w500, w700]) =>
      `@font-face{font-family:Caveat;font-weight:500;src:url(${w500}) format('woff2')}` +
      `@font-face{font-family:Caveat;font-weight:700;src:url(${w700}) format('woff2')}`,
  )
  return fontCss
}

async function svgToJpeg(svg: SVGSVGElement, scale = 2): Promise<{ data: string; w: number; h: number }> {
  const vb = svg.viewBox.baseVal
  const w = vb.width * scale
  const h = vb.height * scale
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = await embeddedFontCss()
  clone.insertBefore(style, clone.firstChild)
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render log sheet'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { data: canvas.toDataURL('image/jpeg', 0.93), w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function downloadLogsPdf(svgs: SVGSVGElement[], filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 24
  for (let i = 0; i < svgs.length; i++) {
    const img = await svgToJpeg(svgs[i])
    const fit = Math.min((pageW - 2 * margin) / img.w, (pageH - 2 * margin) / img.h)
    const w = img.w * fit
    const h = img.h * fit
    if (i > 0) pdf.addPage()
    pdf.addImage(img.data, 'JPEG', (pageW - w) / 2, margin, w, h, undefined, 'FAST')
  }
  pdf.save(filename)
}
