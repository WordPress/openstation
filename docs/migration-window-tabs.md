# Migration: a native window's tabs move to the window chrome

**Who this affects:** plugins calling `openstation_register_window_tab()`, and anything styling or querying the `<os-tabs>` element that used to appear inside a multi-tab native window's body.

**Who it does not:** plugins using `<os-tabs>` for a tab group *inside* content (a switcher within one pane, a segmented view in a panel). That component is unchanged and remains the right tool for that job.

## What changed

A native window with more than one registered tab used to have its body wrapped in `<os-stack>` + `<os-tabs>` + one `<os-tabpanel>` per tab. The strip was part of the window's content, sitting at the top of the body.

The strip is now built by the shell, in the window chrome, directly under the title bar. It is the same strip an admin-page window wears for its sub-pages, and it is built from the tab metadata the shell already receives, so the markup no longer carries one.

Before:

```html
<div class="os-window__body">
  <os-stack gap="12" padding="16">
    <os-tabs value="main">
      <os-tab value="main">Main</os-tab>
      <os-tab value="acme/reports">Reports</os-tab>
    </os-tabs>
    <os-tabpanel for="main">…</os-tabpanel>
    <os-tabpanel for="acme/reports">…</os-tabpanel>
  </os-stack>
</div>
```

After:

```html
<nav class="os-window__tabs" role="tablist" aria-label="Jorvy sections">…</nav>
<div class="os-window__body">
  <os-stack gap="12" padding="16">
    <os-tabpanel for="main">…</os-tabpanel>
    <os-tabpanel for="acme/reports">…</os-tabpanel>
  </os-stack>
</div>
```

## What you do not have to change

`openstation_register_window_tab()` is unchanged: same signature, same arguments, same `main_tab_padding` and `openstation_native_window_tab_wrap_padding` controls over the wrap. Your tab still appears, in the same order, with the same label. Panes are still `<os-tabpanel for="…">` and are still stamped `hidden` server-side so first paint is correct.

If your plugin only registers tabs and renders their panes, there is nothing to do.

## What you do have to change

### Listening for tab changes

The strip is no longer an `<os-tabs>` element, so it no longer emits `os-tab-change`.

```js
// Before
document.querySelector( 'os-tabs' )
    .addEventListener( 'os-tab-change', ( e ) => { … } );

// After — bubbles from the window element
windowEl.addEventListener( 'os-window-tab-change', ( e ) => {
    e.detail.value; // the tab's value
} );
```

`os-window-tab-change` bubbles, so a listener on `document` works too. See [`javascript-reference.md`](javascript-reference.md).

### Styling or querying the old strip

CSS or JS targeting `os-tabs` **inside a native window body** no longer matches anything. There is no drop-in selector to swap in, and that is deliberate: the strip is window chrome now, shared with every other window, and a plugin restyling it would be restyling the shell.

Retint it through the tokens the strip reads instead, which reach every window and every desktop theme: `--os-tabs-bg` and `--os-tabs-bg-unfocused` (the track), `--os-tabs-color` (inactive labels), `--os-tabs-rail` and `--os-tabs-rail-width` (the accent line), `--os-tabs-radius`, `--os-tabs-slide`. On a native window the active tab wears `--os-window-bg`, the same token that paints the body it belongs to.

### Driving tabs from JS

If you were setting `.value` on the `<os-tabs>` element to switch panes, use the window instead:

```js
const win = wp.os.windowManager.getById( 'jorvy' );
win.activateTab( 'acme/reports' );
```

`win.setTabs( entries, activeValue? )` declares tabs for a native window registered purely in JS. Server-registered tabs are declared for you.

## Why

Native windows were skipped when the shell built its tab strip, so a window that wanted tabs had to grow its own inside its body. That left two implementations of one design, drifting apart, and only one of them had the tab strip's look, its keyboard, or its accessibility wiring.

There is one now. A native window's tabs get the roving `tabindex`, the arrow keys, `aria-controls` paired both ways with each pane, and the same active-tab surface as every other window in the shell, for free.
