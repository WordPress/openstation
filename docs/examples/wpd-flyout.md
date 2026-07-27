# `<wpd-flyout>` — window-scoped sliding card

For the recurring "auxiliary card that slides in inside a window" pattern. Account panels, filter sidebars, navigation drawers, settings overlays — each one had ~120 LOC of bespoke wiring before. The component bakes the spec the wpd-tumblr 0.1.x prototype validated by hand: containment, margins from every edge, focus capture-and-restore (with `preventScroll`), focus trap, click-outside-via-pointerdown scoped to the window, no backdrop by default. *Experimental.*

## Containment is the headline

`<wpd-flyout>` is `position: absolute` and lives **inside the window body**, which the framework styles `position: relative; overflow: hidden`. The flyout cannot escape its window — close one window, the flyout tears down with it. There is no viewport-fixed drawer, no `z-index: 9999` shouting match. The card sits at `z-index: 10` above the window's main content, below the shell's chrome.

Margins from every edge: `inset-block: 64px 14px; inset-inline-end: 14px;` — the title bar stays visible above, the trailing edges keep gutters so the card reads as **a floating panel inside the window**, not as a panel pinned to the viewport edge.

## Minimal example

```html
<!-- The flyout — a sibling of your window's main content. -->
<wpd-flyout id="account" placement="end" aria-label="Account">
    <header style="padding: 16px;">
        <h2 style="margin: 0;">My Account</h2>
    </header>
    <main style="padding: 16px;">
        <p>Username: <strong>jorvy</strong></p>
        <button id="signout">Sign out</button>
        <button data-flyout-close>Close</button>
    </main>
</wpd-flyout>

<!-- The trigger — anywhere else in the window's body. -->
<button id="open-account-btn">Account</button>
```

```js
const flyout = document.getElementById( 'account' );
const trigger = document.getElementById( 'open-account-btn' );

trigger.addEventListener( 'click', () => {
    flyout.setAttribute( 'open', '' );
} );

flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
    // e.detail.reason: 'escape' | 'pointer' | 'close-button' | 'api'
    if ( e.detail.reason !== 'api' ) {
        analytics.track( 'flyout.user-dismiss', { reason: e.detail.reason } );
    }
} );
```

That's the whole UX. The component:

- Captures the **trigger** (the focused element when `open` flips on) and restores focus to it on dismiss — both with `{ preventScroll: true }` so the off-screen-during-transition target doesn't jitter the window.
- Moves focus into the panel on open. Tab cycles within; Shift+Tab wraps. The trigger is unreachable until close.
- Listens for `pointerdown` events on the **window body** (not the document). A click anywhere outside the panel but inside the window dismisses with reason `'pointer'`. Clicking the trigger itself is ignored — its own click handler decides.
- Listens for Escape on `document`. When the flyout is open, Escape dismisses with reason `'escape'` and consumes the event.
- Detects buttons inside the panel marked `data-flyout-close`. Clicking dismisses with reason `'close-button'`.
- When external code removes `open` imperatively, fires reason `'api'`.

## Placements

| `placement` | Anchor | Slide direction |
|---|---|---|
| `end` *(default)* | inline-end edge (right in LTR, left in RTL) — `inset-block: 64px 14px; inset-inline-end: 14px;` | from inline-end |
| `start` | inline-start edge | from inline-start |
| `top` | block-start edge | from above |

The `inset-inline-*` properties make `start` / `end` direction-aware automatically — RTL flips the side AND the slide direction. `prefers-reduced-motion: reduce` snaps the panel in/out instantly.

## Scope — where the click-outside listener lives

Default `scope="window"` walks up the DOM until it finds a `.desktop-mode-window__body`. That's the right setting for any flyout opened inside a desktop-mode native window. Two escape hatches:

- `scope="parent"` — listen on the immediate parent element. Useful for flyouts mounted inside ad-hoc containers (component showcase, isolated stories).
- `scope="document"` — listen on `document.body`. Last-resort for full-page contexts.

```html
<wpd-flyout placement="end" scope="window">…</wpd-flyout>
<wpd-flyout placement="end" scope="parent">…</wpd-flyout>
```

## Theming

Custom-property hooks for the few values plugins typically override:

```css
wpd-flyout {
    --wpd-flyout-bg:        #ffffff;                    /* card surface */
    --wpd-flyout-fg:        var(--desktop-mode-fg);     /* text colour */
    --wpd-flyout-shadow:    0 16px 48px rgba(0, 25, 53, 0.4);
    --wpd-flyout-backdrop:  rgba(0, 0, 0, 0.4);         /* default: transparent */
}
```

The default `--wpd-flyout-backdrop: transparent` keeps the flyout **additive** — clicks anywhere outside the panel dismiss, but the rest of the UI stays interactive-looking. Set a non-transparent value when the plugin wants window-scoped modality (the rest of the window dims, but other windows stay live — distinct from `<wpd-confirm-dialog>`'s viewport-modal pattern).

## All four dismissal paths fire one event

The `wpd-flyout-dismiss` event fires on **every** close — including when external code removes `open` imperatively. The `detail.reason` discriminator lets subscribers branch:

```js
flyout.addEventListener( 'wpd-flyout-dismiss', ( e ) => {
    switch ( e.detail.reason ) {
        case 'escape':
        case 'pointer':
        case 'close-button':
            // user-driven dismissal
            break;
        case 'api':
            // your own code closed it
            break;
    }
} );
```

This means you can write the close-handler once and have it fire whether the user pressed Escape, clicked outside the panel, hit a `data-flyout-close` button, or you ran `flyout.removeAttribute('open')` from a sibling button click.

## Accessibility

- Defaults `role="dialog"`. Set `aria-label` or `aria-labelledby` so screen readers announce the flyout's purpose.
- `inert` is applied to the host while closed — Tab navigation and screen readers skip the off-screen content.
- Focus moves into the panel on open with `{ preventScroll: true }` (per the spec, this is the gotcha that bites every hand-rolled implementation: without it, the off-screen-during-transition target gets scrolled into view and the whole window jitters).
- Focus restores to the trigger on close, also with `preventScroll: true`.
- `prefers-reduced-motion: reduce` disables the slide animation.

## Cleanup

When the component disconnects (the host is removed from the DOM, or its window closes), every listener detaches: the document-level Escape, the scope-root pointerdown, the host-level Tab trap, the host-level click handler. A window-close that drops the flyout host doesn't leak handlers.

## See also

- [`<wpd-confirm-dialog>`](../components-reference.md) — the modal Yes/No sibling for "block everything until the user decides".
- [`layout-primitives.md`](./layout-primitives.md) — `<wpd-*>` layout components for the panel content.
