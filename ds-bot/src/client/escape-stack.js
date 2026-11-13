// Escape closes one layer: the newest one open. A window, a card stack and the window a
// card opens are three layers, so Escape over the card window never reaches the column
// underneath it. Pure, so the order is tested without a page.
export const createEscapeStack = () => {
  const layers = []
  const send = (event) => { if (event?.key === 'Escape') layers.at(-1)?.() }
  return {
    push(close) {
      layers.push(close)
      return () => {
        const at = layers.indexOf(close)
        if (at >= 0) layers.splice(at, 1)
        return layers.length
      }
    },
    press: (event) => send(event),
    depth: () => layers.length,
  }
}
