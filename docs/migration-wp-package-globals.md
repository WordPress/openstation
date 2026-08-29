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

## Lazily-loaded scripts — what is replayed, and what is not

WordPress resolves a script's dependencies when it **enqueues** it. A
handle that OpenStation only ever fetches lazily never goes through
that pass: the loader injects one URL and nothing else, so a declared
dependency is not on the page when the bundle runs. A declared
dependency still resolves normally whenever WordPress itself enqueues
the handle — the gap is specific to handles only ever fetched lazily.

**Widget bundles close that gap.** `openstation_register_widget()`
resolves the handle's dependency closure server-side and ships it in
the payload, and the loader executes those handles in order before the
widget's own — each with its `wp_localize_script` /
`wp_add_inline_script` / `wp_set_script_translations` data attached.
Declare your packages and it works.

**A package the page already has is never replayed**, so a page that
carried the packages anyway pays nothing — and, more to the point, a
singleton package is never evaluated twice. Re-running `wp-hooks`
assigns a fresh registry to `window.wp.hooks` and everything that
subscribed before that point goes deaf; re-running `wp-data` wipes
every registered store.

"Already in the document" is answered by handle as well as by URL,
because on a stock wp-admin the URL alone cannot answer it. Core
concatenates every script below `wp-includes/js/` and `wp-admin/js/`
into a single `load-scripts.php` response — the wp-admin default, off
only under `SCRIPT_DEBUG` — so those packages are in the tab with no
`<script src>` of their own to match. The blob names the handles it
carries in its own query string, and the shell reads them back
(`src/script-presence.ts`). Nothing is asked of you: the handles ride
along in the payload OpenStation builds from your registration.

**No other lazy path does this yet.** Native-window scripts, command
scripts, settings-tab scripts, wallpapers, games and desktop-file
openers all travel the same loader, but their payload builders do not
resolve a closure. If one of those needs a `@wordpress/*` package,
either enqueue the handle normally so WordPress resolves it, or load
the package yourself before use — do not rely on load order.

The loader side of the mechanism is generic, so extending the
remaining builders is a payload change rather than a new mechanism.
