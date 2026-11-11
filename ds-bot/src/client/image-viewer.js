import { createElement as h, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons.js'
import { t } from './i18n.js'

// The images the conversation shows, in the order it shows them: a Bot's Markdown
// pictures and the user's attachments alike, read from the transcript itself so paging
// follows exactly what is on screen (and follows the loaded history too).
const IN_TRANSCRIPT = '.bt-astack img, .bt-ububble img, .bt-umsg img, .bt-uimgs img'

export function imagesInView() {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll(IN_TRANSCRIPT)].map(img => ({
    src: img.currentSrc || img.src,
    label: img.alt ?? '',
  }))
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
  url === '' ? h('span', { className: 'bt-uimg-wait', 'aria-hidden': true }) : h('img', { src: url, alt: label, draggable: false }),
  h('span', { className: 'bt-uimg-glow', 'aria-hidden': true }))
}

// The images of one message, in a row: one large, several as tiles.
export function MessageImages({ sessionId, seq, blocks, actions }) {
  const entries = blocks.map((block, index) => ({ key: keyOf(seq, index), attachment: block.attachment, label: block.attachment?.name, sessionId }))
  const single = entries.length === 1
  return h('div', { className: single ? 'bt-uimgs bt-uimgs-single' : 'bt-uimgs' },
    entries.map(entry => h(Thumb, { key: entry.key, image: entry, single, actions })))
}

// The opened image: the conversation's images before and after it, the count, and the
// way back to the chat. The dialog holds focus, so the arrows never reach the composer.
export function ImageViewer({ viewer, actions, leaving = false }) {
  const images = viewer.images ?? []
  const [index, setIndex] = useState(viewer.index ?? 0)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef(null)
  const current = images[index]
  const close = () => actions.closeImageViewer?.()
  useEffect(() => {
    dialog.current?.focus()
  }, [])
  useEffect(() => { setFailed(false) }, [index, attempt])
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
      failed
        ? h('div', { className: 'bt-imgview-failed', role: 'status' },
          h('span', null, t('This image could not be loaded.')),
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => setAttempt(value => value + 1) }, t('Try again')))
        : current === undefined
          ? h('div', { className: 'bt-imgview-wait', role: 'status' }, t('Loading image…'))
          : h('img', {
            key: `${current.src}:${attempt}`,
            className: 'bt-imgview-img', src: current.src, alt: current.label ?? '', draggable: false,
            onError: () => setFailed(true),
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
.bt-imgview-img{max-width:100%;max-height:calc(92vh - 120px);object-fit:contain;border-radius:10px;background:var(--bt-card)}
.bt-imgview-nav{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid var(--bt-line-2);border-radius:50%;background:var(--bt-card);color:var(--bt-ink);cursor:pointer;transition:opacity .12s ease}
.bt-imgview-nav:hover:not(:disabled){background:var(--bt-hover)}
.bt-imgview-nav:disabled{opacity:.28;cursor:default}
.bt-imgview-wait,.bt-imgview-failed{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-width:280px;min-height:220px;color:var(--bt-ink-2);font-size:13px}
@media (max-width:560px){.bt-imgview{width:calc(100vw - 24px);padding:8px}.bt-imgview-nav{width:32px;height:32px}.bt-imgview-count{font-size:11px}}
`
