import { createElement as h, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons.js'
import { t } from './i18n.js'

// The images the conversation shows, in the order it shows them: a Bot's Markdown
// pictures and the user's attachments alike, read from the transcript itself so paging
// follows exactly what is on screen (and follows the loaded history too).
const IN_TRANSCRIPT = '.bt-astack img, .bt-ububble img, .bt-umsg img, .bt-uimgs img'

// An attachment-backed thumbnail remembers what it renders, so the viewer can ask the
// Session for a fresh URL instead of reusing a URL the transcript already spent: the
// shell's file URLs are per-mount, and a second read of one comes back empty.
const attachmentOf = new WeakMap()

export function imagesInView() {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll(IN_TRANSCRIPT)].map((img) => {
    const held = attachmentOf.get(img)
    return {
      src: img.currentSrc || img.src,
      label: img.alt ?? '',
      img,
      ...(held === undefined ? {} : held),
    }
  })
}

// What kind of URL a source is, for the failure line: a blob the page revoked, an
// inline picture, or a server read are different problems.
export function sourceKind(src) {
  const text = String(src ?? '')
  if (text.startsWith('blob:')) return 'blob'
  if (text.startsWith('data:')) return 'data'
  if (text.startsWith('http:') || text.startsWith('https:')) return 'http'
  if (text === '') return 'empty'
  return 'other'
}

// The picture to show, in the order that keeps it visible: a fresh attachment read,
// then the pixels the transcript already decoded (a canvas copy survives a URL that
// cannot be used twice), then the URL as it stands.
export async function resolveImage(entry, actions, sessionId) {
  if (entry?.attachment !== undefined && typeof actions?.loadImage === 'function') {
    try {
      const url = await actions.loadImage(sessionId ?? entry.sessionId, entry.attachment)
      if (typeof url === 'string' && url !== '') return { url, kind: sourceKind(url) }
    } catch {}
  }
  const shot = snapshotOf(entry?.img)
  if (shot !== '') return { url: shot, kind: 'data' }
  return { url: entry?.src ?? '', kind: sourceKind(entry?.src) }
}

// A loaded transcript image copied to a data URL, bounded so a huge screenshot does not
// become a hundred-megabyte string. Its own canvas draws what the user already sees.
export function snapshotOf(img, max = 2400) {
  try {
    if (img === undefined || img === null || !(img.naturalWidth > 0)) return ''
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (context === null) return ''
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

// Why a preview is empty, in one line the user can send us: the URL's kind, how much
// the browser decoded, and the start of the source.
export function failureNote(entry, naturalWidth = 0) {
  const src = String(entry?.src ?? '')
  return t('{kind} image, {width}px decoded, src: {src}', {
    kind: sourceKind(src), width: Number.isFinite(naturalWidth) ? naturalWidth : 0, src: src.slice(0, 40) || '(none)',
  })
}

// Open the pager on one of those images. The shell's Markdown opens its own single-image
// lightbox on the same click; the caller stops that event when this returns true.
export function openImageAt(img, actions) {
  const src = img.currentSrc || img.src
  const images = imagesInView()
  const index = images.findIndex(entry => entry.src === src)
  if (index < 0) return false
  actions.openImageViewer?.(images, index)
  return true
}

// A bubble's images open the pager, not the shell's single-image lightbox.
export function imageClickHandler(actions) {
  return (event) => {
    const img = event.target instanceof Element ? event.target.closest('img') : null
    if (img === null || !openImageAt(img, actions)) return
    event.preventDefault()
    event.stopPropagation()
  }
}

const keyOf = (seq, index) => `${seq}:${index}`

// One image in the transcript: its bytes resolve through the Session's own loader, so a
// message that arrives as a preview shows as it is and nothing reads another Session's
// images. A load that fails keeps a retry instead of an empty box.
function Thumb({ image, single, actions }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setUrl('')
    setFailed(0)
    Promise.resolve(actions.loadImage?.(image.sessionId, image.attachment)).then((resolved) => {
      if (alive && typeof resolved === 'string') setUrl(resolved)
    }, () => { if (alive) setFailed(value => value + 1) })
    return () => { alive = false }
  }, [image.sessionId, image.attachment, attempt])
  const label = image.label || t('Image')
  if (failed > 0) {
    return h('div', { className: 'bt-uimg-failed', role: 'status' },
      h('span', { className: 'bt-uimg-failed-text' }, t('This image could not be loaded.')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setAttempt(value => value + 1) }, t('Try again')))
  }
  return h('button', {
    type: 'button', className: single ? 'bt-uimg bt-uimg-single' : 'bt-uimg bt-uimg-tile',
    'aria-label': t('Open image {name}', { name: label }), title: label,
    onClick: (event) => {
      const img = event.currentTarget.querySelector('img')
      if (img !== null) openImageAt(img, actions)
    },
  },
  url === '' ? h('span', { className: 'bt-uimg-wait', 'aria-hidden': true }) : h('img', {
    src: url, alt: label, draggable: false,
    ref: (node) => { if (node !== null) attachmentOf.set(node, { attachment: image.attachment, sessionId: image.sessionId }) },
  }),
  h('span', { className: 'bt-uimg-glow', 'aria-hidden': true }))
}

// The images of one message, in a row: one large, several as tiles.
export function MessageImages({ sessionId, seq, blocks, actions }) {
  const entries = blocks.map((block, index) => ({ key: keyOf(seq, index), attachment: block.attachment, label: block.attachment?.name, sessionId }))
  const single = entries.length === 1
  return h('div', { className: single ? 'bt-uimgs bt-uimgs-single' : 'bt-uimgs' },
    entries.map(entry => h(Thumb, { key: entry.key, image: entry, single, actions })))
}

// What the viewer is opened with: the conversation's images in order, and which one was
// clicked. One shape, so the action that stores it and the component that reads it cannot
// drift apart.
export const viewerFor = (images, index) => ({ images: Array.isArray(images) ? images : [], index: Number.isInteger(index) && index >= 0 ? index : 0 })

// The opened image: the conversation's images before and after it, the count, and the
// way back to the chat. The dialog holds focus, so the arrows never reach the composer.
export function ImageViewer({ viewer, actions, leaving = false }) {
  const images = viewer.images ?? []
  const [index, setIndex] = useState(viewer.index ?? 0)
  const [shown, setShown] = useState({ url: '', kind: '' })
  const [failed, setFailed] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef(null)
  const current = images[index]
  const close = () => actions.closeImageViewer?.()
  useEffect(() => {
    dialog.current?.focus()
  }, [])
  useEffect(() => {
    let alive = true
    setShown({ url: '', kind: '' })
    setFailed('')
    if (current === undefined) return undefined
    void resolveImage(current, actions, viewer.sessionId).then((result) => {
      if (!alive) return
      if (result.url === '') setFailed(failureNote(current))
      else setShown(result)
    }).catch(() => { if (alive) setFailed(failureNote(current)) })
    return () => { alive = false }
  }, [viewer.sessionId, current?.src, current?.attachment, attempt])
  const go = (step) => {
    const next = index + step
    if (next >= 0 && next < images.length) setIndex(next)
  }
  const atStart = index <= 0
  const atEnd = images.length === 0 || index >= images.length - 1
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); return }
    if (event.key === 'ArrowLeft') { event.stopPropagation(); event.preventDefault(); go(-1); return }
    if (event.key === 'ArrowRight') { event.stopPropagation(); event.preventDefault(); go(1) }
  }
  return h('div', { className: 'bt-imgview-layer', 'data-leaving': leaving || undefined },
    h('div', { className: 'bt-scrim', onMouseDown: close }),
    h('div', {
      ref: dialog, className: 'bt-imgview', role: 'dialog', 'aria-modal': true, tabIndex: -1,
      'aria-label': t('Image viewer'), onKeyDown,
    },
    h('div', { className: 'bt-imgview-head' },
      h('span', { className: 'bt-imgview-count' }, images.length === 0 ? '' : t('{at} / {count}', { at: index + 1, count: images.length })),
      h('span', { className: 'bt-imgview-name' }, current?.label ?? ''),
      h('button', { type: 'button', className: 'bt-round', 'aria-label': t('Close'), title: t('Close'), onClick: close }, h(CloseIcon))),
    h('div', { className: 'bt-imgview-body' },
      h('button', {
        type: 'button', className: 'bt-imgview-nav', 'data-side': 'prev', disabled: atStart,
        'aria-label': t('Previous image'), title: t('Previous image'), onClick: () => go(-1),
      }, h(ChevronLeftIcon)),
      failed !== ''
        ? h('div', { className: 'bt-imgview-failed', role: 'alert' },
          h('span', null, t('This image could not be loaded.')),
          h('code', { className: 'bt-imgview-note' }, failed),
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setAttempt(value => value + 1) }, t('Try again')))
        : shown.url === ''
          ? h('div', { className: 'bt-imgview-wait', role: 'status' }, t('Loading image…'))
          : h('img', {
            key: `${shown.url.slice(0, 64)}:${attempt}`,
            className: 'bt-imgview-img', src: shown.url, alt: current?.label ?? '', draggable: false,
            onError: (event) => setFailed(failureNote(current, event.currentTarget.naturalWidth)),
          }),
      h('button', {
        type: 'button', className: 'bt-imgview-nav', 'data-side': 'next', disabled: atEnd,
        'aria-label': t('Next image'), title: t('Next image'), onClick: () => go(1),
      }, h(ChevronRightIcon)))))
}

export const IMAGE_VIEWER_CSS = `
.bt-uimgs{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:100%}
.bt-uimg{position:relative;display:block;padding:0;overflow:hidden;border:.5px solid var(--bt-line-2);background:var(--bt-card);cursor:zoom-in;border-radius:12px}
.bt-uimg:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-uimg-single{width:min(320px,100%);aspect-ratio:4/3}
.bt-uimg-tile{width:88px;height:88px}
.bt-uimg img{display:block;width:100%;height:100%;object-fit:cover}
.bt-uimg-wait{display:block;width:100%;height:100%;min-height:88px;background:color-mix(in srgb,var(--bt-ink) 6%,transparent);animation:bt-uimg-pulse 1.4s ease-in-out infinite}
@keyframes bt-uimg-pulse{50%{opacity:.55}}
.bt-uimg-glow{position:absolute;inset:0;box-shadow:inset 0 0 0 1px var(--bt-line);border-radius:inherit;pointer-events:none}
.bt-uimg-failed{width:240px;min-height:88px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:6px;padding:10px 12px;border:.5px dashed var(--bt-line-2);border-radius:12px;color:var(--bt-ink-2);font-size:12px;line-height:18px;box-sizing:border-box}
.bt-imgview-layer{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center}

.bt-imgview{position:relative;display:flex;flex-direction:column;width:min(92vw,1000px);max-height:92vh;padding:10px 12px 12px;border:1px solid var(--bt-line-2);border-radius:16px;background:var(--bt-main);color:var(--bt-ink);box-shadow:var(--bt-glass-shadow);outline:none;box-sizing:border-box}
.bt-imgview-head{display:flex;align-items:center;gap:10px;padding:0 0 8px}
.bt-imgview-count{font-size:12px;line-height:18px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-imgview-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--bt-ink-3)}
.bt-imgview-body{position:relative;display:flex;align-items:center;gap:8px;min-height:120px;justify-content:center}
.bt-imgview-body{min-height:180px}
.bt-imgview-img{display:block;max-width:100%;max-height:calc(92vh - 120px);min-width:120px;min-height:120px;object-fit:contain;border-radius:10px;background:var(--bt-card)}
.bt-imgview-note{display:block;max-width:100%;padding:6px 8px;border-radius:8px;background:var(--bt-tag-bg);color:var(--bt-ink-3);font-size:11px;line-height:16px;word-break:break-all;text-align:left}
.bt-imgview-nav{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid var(--bt-line-2);border-radius:50%;background:var(--bt-card);color:var(--bt-ink);cursor:pointer;transition:opacity .12s ease}
.bt-imgview-nav:hover:not(:disabled){background:var(--bt-hover)}
.bt-imgview-nav:disabled{opacity:.28;cursor:default}
.bt-imgview-wait,.bt-imgview-failed{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-width:280px;min-height:220px;color:var(--bt-ink-2);font-size:13px}
@media (max-width:560px){.bt-imgview{width:calc(100vw - 24px);padding:8px}.bt-imgview-nav{width:32px;height:32px}.bt-imgview-count{font-size:11px}}
`
