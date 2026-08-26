# Migration — WordPress package globals are no longer ambient

**Who this affects:** plugins whose widget, native window, command, or
any other lazily-loaded script touches `wp.apiFetch`, `wp.element`,
`wp.data`, `wp.components` or any other `@wordpress/*` global.

**What to do:** declare the package as a dependency of your script.
That is all — and it was always the documented contract. What changed
is that failing to do it used to work anyway.

## What changed

Until 1.1.3, Core's ⌘K command palette was enqueued on every admin
page, and its dependency chain is the whole Gutenberg runtime. As a
side effect, `wp.apiFetch`, `wp.element`, `wp.data` and `wp.components`
were on every admin page whether anything asked for them or not.

That runtime is now deferred to the first time the palette is actually
invoked. On a fresh boot those globals are **undefined until the user
presses ⌘K**, and the shell no longer carries ~10 MB of Gutenberg it
mostly never used.

## The symptom

A script registered like this:

```php
wp_register_script( 'acme-widget', $url, array(), $ver, true );
```

…that then calls `wp.apiFetch( … )` throws
`TypeError: wp.apiFetch is undefined` at mount, and mysteriously starts
working later in the same session — once the user happens to open the
palette and the runtime lands.

In-tree bundles are self-contained and were unaffected, which is why
the test suite did not catch this.

## The fix

Declare what you use:

```php
wp_register_script(
    'acme-widget',
    $url,
    array( 'wp-api-fetch', 'wp-element' ),  // ← every package you touch
    $ver,
    true
);
```

WordPress resolves declared dependencies when your script is enqueued,
so the packages are present before your code runs — no timing
assumptions, no waiting on the palette.

## Why not restore the globals

Because they were never a contract, and putting them back means putting
back the cost: on a plain Settings screen the palette chain was 43
files, 10.66 MB raw / 1.94 MB gzipped — 73.6% of everything the window
downloaded — parsed and executed again in every window's own JavaScript
realm, where an HTTP cache hit buys nothing.

## A note on lazily-loaded scripts

Scripts delivered through OpenStation's lazy paths — widget bundles,
native-window scripts, command scripts — are injected by URL and their
dependency closure is **not** replayed ahead of them. A declared
dependency still resolves correctly whenever WordPress itself enqueues
the handle; the gap is specific to handles that are only ever fetched
lazily. If your script must run inside one of those and needs a
package, load it yourself before use rather than relying on load order.
