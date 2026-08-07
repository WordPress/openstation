# Show a banner at the top of a window

A **window notice** is a tone-coded banner pinned to the top of one
or more windows — between the title bar and the content area, full
width. The user can dismiss it (default), and the dismissal is
remembered per-user in `localStorage` so the same banner never
re-appears for them.

Notices are pure declarative data: tone, message (HTML), an optional
dashicons glyph, and an optional `match` selector. The shell renders
each entry as a `<os-notice>` web component inside the matching
window's `after-titlebar` slot.

## PHP — register a banner on a single window

```php
<?php
defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    openstation_register_window_notice( array(
        'id'      => 'my-plugin/welcome-posts',
        'tone'    => 'info',
        'message' => __(
            '<strong>Welcome to My Plugin.</strong> Try the new <a href="…">bulk-edit overlay</a>.',
            'my-plugin'
        ),
        'icon'    => 'dashicons-info',
        'match'   => array( 'window' => 'edit-php' ), // Posts window
    ) );
} );
```

## PHP — banner that applies to several "kinds" of window

```php
openstation_register_window_notice( array(
    'id'      => 'my-plugin/holiday-banner',
    'tone'    => 'warning',
    'message' => __( 'Holiday freeze in effect — content edits are read-only.', 'my-plugin' ),
    'match'   => array(
        'windows' => array(
            'edit-php',          // Posts
            'edit-php-page',     // Pages
            'upload-php',        // Media
        ),
    ),
) );
```

## PHP — match by URL substring

For plugin pages whose window id is derived from a long URL (e.g.
`admin.php?page=wc-admin&path=/analytics`), match by URL substring
instead of trying to predict the slug:

```php
openstation_register_window_notice( array(
    'id'      => 'my-plugin/wc-promo',
    'tone'    => 'success',
    'message' => __( 'Black Friday rate now available on the API.', 'my-plugin' ),
    'match'   => array( 'urlContains' => 'wc-admin' ),
) );
```

## How `match` selectors combine

Three selector types are accepted: `window` (single id), `windows`
(list of ids), and `urlContains`. Their combination rules:

- **Within `windows`**, ids are **OR**'d — the window matches if its
  id is any of the entries.
- **Across selector types**, the semantics is **AND** — the window
  must satisfy every selector that was set. For example, this notice
  appears only on the Posts window *whose URL also contains
  `wc-admin`*:

  ```php
  openstation_register_window_notice( array(
      'id'    => 'my-plugin/wc-posts',
      // …
      'match' => array(
          'windows'     => array( 'edit-php' ),
          'urlContains' => 'wc-admin',
      ),
  ) );
  ```

  It does **not** mean "every Posts window OR every wc-admin URL." To
  get OR across selector types, register two separate notices (they
  can share the same `id` only if you want one to replace the other —
  use different ids otherwise).

## JavaScript — register from a plugin bundle

The same API is exposed on `wp.os` with a fully-flexible `match`
predicate (any synchronous function of the `Window` instance):

```js
const unregister = wp.os.registerWindowNotice( {
    id: 'my-plugin/welcome',
    tone: 'info',
    message: 'Welcome! <a href="/wp-admin/">Open admin home</a>.',
    match: ( win ) => win.id === 'edit-php',
} );

// Later — remove the notice declaratively:
unregister();
```

### Imperative dismissal / un-dismissal

```js
// Mark a notice as dismissed for the current user.
wp.os.dismissWindowNotice( 'my-plugin/welcome' );

// Clear the dismissal so it shows again on next mount.
wp.os.undismissWindowNotice( 'my-plugin/welcome' );

// Snapshot for debugging:
console.log( wp.os.listWindowNotices() );
```

## Allowed tones

`info` (default), `success`, `warning`, `error` (alias `danger`),
`neutral`. Plugins that need a brand color can override the
underlying CSS variables on the `<os-notice>` host:

```css
os-notice[ tone='info' ] {
    --os-ui-notice-info: #6a4af5;
    --os-ui-notice-info-bg: rgba( 106, 74, 245, 0.08 );
}
```

## What HTML is allowed in `message`

PHP-registered messages pass through `wp_kses_post()` — links,
inline formatting (`<strong>`, `<em>`, `<br>`, `<code>`), and
`<span>`s with class names survive; `<script>` and other unsafe
markup are stripped.

JS-registered messages are written via `innerHTML` as-is. Treat the
field as a trusted string: include only content you author, and run
any user-supplied data through an HTML sanitizer first.

## Hiding the close button

Pass `dismissible: false` (PHP) or the `not-dismissible` attribute
(component-level) for a banner the user can't dismiss — useful for
hard-coded state messages like "Read-only mode."

```php
openstation_register_window_notice( array(
    'id'          => 'my-plugin/read-only',
    'tone'        => 'warning',
    'dismissible' => false,
    'message'     => __( 'This window is in read-only mode.', 'my-plugin' ),
) );
```

## Stacking multiple notices

Each call to `openstation_register_window_notice()` /
`wp.os.registerWindowNotice()` registers an independent slot
renderer. When multiple notices match the same window, they stack in
`order` ascending (default 100). Set `order` explicitly to control
the visual hierarchy.

## Server-side filter

Plugins can mutate the final list right before it ships to the
shell — handy for request-time banners (e.g. "your trial expires
today"):

```php
add_filter( 'openstation_window_notices', function ( $entries ) {
    if ( my_plugin_trial_expires_today() ) {
        $entries[] = array(
            'id'      => 'my-plugin/trial-expires',
            'tone'    => 'warning',
            'message' => __( 'Your trial expires today.', 'my-plugin' ),
        );
    }
    return $entries;
} );
```
