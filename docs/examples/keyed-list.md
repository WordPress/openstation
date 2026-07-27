# Render a list without losing clicks — `renderKeyedList()`

**Stable.**

If your plugin paints a list (chat rows, log entries, badges, search
results, anything observable) into a DOM container, and the data can
change while the user is looking at it, you have a subtle race
condition waiting to bite you. `renderKeyedList()` is the framework
helper that prevents it.

## The bug it prevents

Naive list rendering uses `host.innerHTML = ''` followed by a full
rebuild on every state change. That destroys every row's DOM node
and creates fresh ones — same content, different element instances.

If a re-render lands between the user's `mousedown` and `mouseup` on
a row, **the browser does NOT synthesize a click event**, because
mousedown and mouseup ended up on different elements. The user's
click silently does nothing. The row "flashes" via `:hover` and
reverts.

A typical case: a heartbeat-driven list (presence, inbox, log
stream) re-renders every few seconds. Without keyed reconciliation
the re-render destroys whichever row the user is mid-press on, and
their click silently does nothing.

## The fix

Reuse DOM nodes across renders by matching on a stable key. Same key
→ same `<li>`. Different key → only the affected nodes are created
or removed. Listeners attached when a node was first built survive
every subsequent re-render.

```ts
import { renderKeyedList } from 'desktop-mode';

const host = document.querySelector( '#my-list' )!;

function repaint(): void {
    renderKeyedList( host, getCurrentItems(), {
        keyOf: ( item ) => item.id,
        buildItem( item ) {
            const li = document.createElement( 'li' );
            li.dataset.id = String( item.id );
            li.addEventListener( 'click', () => onSelect( item ) );
            // Initial population happens here too.
            const label = document.createElement( 'span' );
            label.textContent = item.title;
            li.appendChild( label );
            return li;
        },
        updateItem( el, item, prev ) {
            // Refresh whatever may have changed since prev.
            const label = el.querySelector< HTMLElement >( 'span' );
            if ( label ) label.textContent = item.title;
        },
    } );
}

// Wire to your store / event bus / heartbeat / poller.
store.subscribe( repaint );
```

The `<li>` for `item.id === 42` is the SAME DOM node every render.
The `click` listener attached in `buildItem` keeps firing forever —
no mid-press race, no document-level capture delegation needed, no
mousedown workaround.

## API

```ts
function renderKeyedList< T >(
    host: HTMLElement,
    items: readonly T[],
    opts: KeyedListOptions< T >,
): void;

interface KeyedListOptions< T > {
    /** Stable identity. Same key = same DOM. */
    keyOf( item: T ): string | number;

    /** Build the DOM the first time we see a key. Attach listeners here. */
    buildItem( item: T ): HTMLElement;

    /** Optional: refresh existing DOM when data changed but key didn't. */
    updateItem?( el: HTMLElement, item: T, prevItem: T | null ): void;
}

function clearKeyedList( host: HTMLElement ): void;
```

- **The host is owned** by the reconciler. Don't mix in hand-managed
  children — they'll be removed on the next render.
- **Reorder is in-place.** Swapping two items moves only those nodes;
  unchanged neighbours stay put.
- **Steady state is free.** A re-render with the exact same items in
  the exact same order does zero DOM writes.

## When to use it

- Conversation lists, message threads, log streams, notification
  badges — anywhere observable data drives a list.
- Any time you'd otherwise be tempted to write
  `host.innerHTML = ''; for (...) host.appendChild(...)` and the
  data can change while the user is interacting.

## When NOT to use it

- One-shot static lists. Just `appendChild` is simpler.
- Lists rendered through a framework's own diffing engine (Lit,
  Preact, etc.). Use the framework's keyed-list directive instead;
  doubling up wastes work.

## Related

- [`docs/javascript-reference.md`](../javascript-reference.md) — the
  `wp.desktop.renderKeyedList()` / `clearKeyedList()` API reference.
