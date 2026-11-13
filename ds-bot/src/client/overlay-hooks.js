import { useEffect, useRef } from 'react'
import { createEscapeStack } from './escape-stack.js'

// -------------------------------------------------------------------------
// Overlays: new chat, bot exchange, details drawer, context menu

// Escape closes only the newest open layer, so a dialog over the details pane does
// not take the pane down with it.
const escapeLayers = createEscapeStack()
let listening = 0
const onEscapeKey = (event) => escapeLayers.press(event)
// `active` lets a layer that is only sometimes open (a card stack in the conversation)
// leave the stack while it is closed, so Escape still reaches the pane below it.
export function useEscape(onClose, active = true) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!active) return undefined
    if (listening === 0) window.addEventListener('keydown', onEscapeKey)
    listening += 1
    const off = escapeLayers.push(() => ref.current())
    return () => {
      off()
      listening -= 1
      if (listening === 0) window.removeEventListener('keydown', onEscapeKey)
    }
  }, [active])
}
