# Build a feed reader without the bookkeeping

Every infinite-scroll plugin in the wild reinvents the same five primitives — `IntersectionObserver` on a sentinel below the last row, an `AbortController` to cancel in-flight pages on filter change, dedup-by-id so refetches don't render the same row twice, cursor pagination, and a "loading more" indicator separate from the window-level spinner.

`wp.desktop.createInfiniteList()` ships every piece of that. *Stable.*

## Minimal recipe

```js
const list = wp.desktop.createInfiniteList( {
    root: document.getElementById( 'feed-root' ),
    fetchPage: async ( cursor, signal ) => {
        const res = await wp.desktop.fetch(
            '/wp-json/myplugin/v1/feed?cursor=' + encodeURIComponent( cursor ?? '' ),
            { signal },
        );
        const json = await res.json();
        return { items: json.items, nextCursor: json.next };
    },
    getId:      ( post ) => post.id,
    renderItem: ( post ) => {
        const li = document.createElement( 'li' );
        li.className = 'feed-row';
        li.textContent = post.title;
        return li;
    },
} );
```

That's the whole feed reader. The first page fetches on mount; the sentinel below the rendered rows triggers the next page when it scrolls into view; rows with the same id only render once; the list stops requesting pages when `nextCursor` is `null`.

## Options

```ts
interface InfiniteListOptions< TItem > {
    root:       HTMLElement;
    fetchPage:  ( cursor: string | null, signal: AbortSignal )
                  => Promise< { items: TItem[]; nextCursor?: string | null } >;
    getId:      ( item: TItem ) => string | number;
    renderItem: ( item: TItem, index: number ) => HTMLElement;

    sentinel?:        HTMLElement;     // override the default 1px sentinel
    rootMargin?:      string;          // IntersectionObserver rootMargin (default '200px')
    initialCursor?:   string | null;   // first call's cursor (default null)
    onLoadingChange?: ( loading: boolean ) => void;
    onError?:         ( err: unknown ) => void;
}
```

## Returned API

```ts
interface InfiniteList {
    reset(): void;                 // re-fetch from initialCursor
    loadMore(): Promise< void >;   // request the next page (sentinel does this for you)
    hasMore(): boolean;            // false once nextCursor returns null/empty
    isLoading(): boolean;
    destroy(): void;               // disconnect observer, abort in-flight, unmount sentinel
}
```

## Filter changes — `reset()`

The single most important thing the helper does for you: **when the user changes a filter, call `list.reset()`**. Any in-flight page from the old filter aborts (the `AbortController` cancels the request the user no longer wants), the rendered rows clear, the dedup set wipes, and a fresh page fetches from `initialCursor`.

```js
filterInput.addEventListener( 'input', ( e ) => {
    currentFilter = e.target.value;
    list.reset();
} );
```

If the slow old request resolves AFTER the new one has started, the helper drops it on the floor — no stale rows.

## Tearing down on close

Native windows: pair the call with the new render-`ctx.signal` so destroy fires on close.

```js
window.desktopModeNativeWindows[ 'my-feed-inbox' ] = ( body, { signal } ) => {
    const root = body.querySelector( '.feed' );
    const list = wp.desktop.createInfiniteList( {
        root,
        fetchPage: ( cursor, fetchSignal ) =>
            // The fetch's own signal is what aborts on filter
            // change. The outer `signal` (window close) is wired
            // up via the cleanup return below.
            myFetchPage( cursor, fetchSignal ),
        getId:      ( p ) => p.id,
        renderItem: buildRow,
    } );
    signal.addEventListener( 'abort', () => list.destroy() );
    return () => list.destroy();
};
```

## Loading indicators

The shell's window-level spinner is reserved for the **first paint**. For the "loading more" indicator at the bottom of the feed (the one users see while scrolling), wire `onLoadingChange` to your own affordance:

```js
const moreSpinner = root.querySelector( '.feed-more-spinner' );
wp.desktop.createInfiniteList( {
    root,
    fetchPage,
    getId, renderItem,
    onLoadingChange: ( loading ) => {
        moreSpinner.toggleAttribute( 'hidden', ! loading );
    },
} );
```

That keeps the title-bar dot and the loading overlay free to mean what they always mean (`wp.desktop.fetch` activity + first-paint readiness) — and the user gets a "loading more" indicator that doesn't conflict with either.

## Custom sentinel

The default sentinel is a 1px `<div>` appended after the rendered items. To use a "Load more" button (or anything else), pass `sentinel`:

```js
const moreBar = document.createElement( 'button' );
moreBar.type = 'button';
moreBar.textContent = 'Load more';
root.appendChild( moreBar );

const list = wp.desktop.createInfiniteList( {
    root,
    sentinel: moreBar,
    fetchPage, getId, renderItem,
} );

moreBar.addEventListener( 'click', () => list.loadMore() );
```

The `IntersectionObserver` still wires up — your bar auto-loads on scroll AND on click, which is what users expect from "load more" affordances that don't disappear off-screen.

## See also

- [`render-ctx.md`](./render-ctx.md) — `signal` from the render ctx aborts on close, perfect for `list.destroy()` on the way out.
- [`window-activity.md`](./window-activity.md) — `wp.desktop.fetch` so the title-bar dot pulses while pages load.
- [`keyed-list.md`](./keyed-list.md) — when the list is small + bounded and you need stable keys for the rows you DO render, not "render more on scroll".
