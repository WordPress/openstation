# Register a slash-command

The AI Assistant palette (`⌘K` / `Ctrl+K`) is extensible. Plugins can contribute slash-commands with `wp.os.registerCommand()`. Typing `/` in the palette shows every registered command; the handler receives whatever the user typed after the slug.

Registrations are live — if the palette is open when you call `registerCommand`, the new command shows up in the list immediately, no page reload required.

---

## Recipe 1 — A one-line `/echo`

The smallest possible example. Types `/echo hello` → assistant replies `hello`.

**my-plugin.php**

```php
<?php
/** Plugin Name: My Echo Command */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    wp_enqueue_script(
        'my-echo',
        plugins_url( 'my-echo.js', __FILE__ ),
        array( 'openstation' ),   // <- hooks into the shell
        '1.0.0',
        true
    );
} );
```

**my-echo.js**

```javascript
( function () {
    // Wait until `wp.os` is available — the shell script loads
    // independently of this one, so we use the `os.init`
    // action which fires after the public API is mounted.
    wp.os.ready( function () {
        wp.os.registerCommand( {
            slug:        'echo',
            label:       'Echo',
            description: 'Repeat the arguments back as a message.',
            hint:        '[text]',
            icon:        'dashicons-format-chat',
            run: function ( args ) {
                return args.trim() || 'Usage: /echo [text]';
            },
        } );
    } );
} )();
```

Press `⌘K`, type `/echo hello world` → the assistant shows `hello world`.
Type `/echo` with no argument → it shows the usage hint.

---

## Recipe 2 — `/turn_on_comments` with a REST call

A more realistic command: parses a post ID argument, hits a plugin REST endpoint, and reports success.

**my-comments.js**

```javascript
wp.os.ready( function () {
    wp.os.registerCommand( {
        slug:        'turn_on_comments',
        label:       'Turn on comments',
        description: 'Re-enable the comments section on a given post.',
        hint:        '[post id]',
        icon:        'dashicons-admin-comments',
        run: async function ( args, ctx ) {
            const id = parseInt( args.trim(), 10 );
            if ( ! id ) {
                return 'Usage: /turn_on_comments [post id]';
            }

            const res = await fetch(
                '/wp-json/my-plugin/v1/enable-comments/' + id,
                {
                    method:  'POST',
                    headers: { 'X-WP-Nonce': openStationConfig.restNonce },
                }
            );

            if ( ! res.ok ) {
                return 'Failed to enable comments — status ' + res.status;
            }

            // Dismiss the palette since we're done.
            ctx.close();

            return 'Comments enabled on post **' + id + '**.';
        },
    } );
} );
```

Note the **markdown support** — `**bold**`, `*italic*`, `[links](https://…)`, inline `` `code` ``, bullet and ordered lists all render in the response bubble.

---

## Recipe 3 — `/open_dashboard` that opens a window

Commands don't have to return a message. Calling `ctx.openInWindow()` and returning `void` is a clean shortcut for "open this page and get out of my way".

```javascript
wp.os.registerCommand( {
    slug:  'open_dashboard',
    label: 'Open the Dashboard',
    icon:  'dashicons-dashboard',
    run:   ( _args, ctx ) => {
        ctx.openInWindow( '/wp-admin/index.php', 'Dashboard', 'dashicons-dashboard' );
        ctx.close();
        // No return value → silent, no bubble.
    },
} );
```

---

## Recipe 4 — Extend the built-in `/open` command

The shell ships with one built-in: `/open [window]`, which autocompletes every admin menu entry (dock + taskbar). Plugins that register native windows or custom destinations add themselves to its list via the `os.open-command.items` filter:

```javascript
wp.hooks.addFilter(
    'os.open-command.items',
    'my-plugin/jorvy-in-open',
    function ( items ) {
        return [
            ...items,
            {
                id:          'jorvy',
                label:       'Jorvy',
                description: 'Marvel quotes window',
                icon:        'dashicons-star-filled',
                open:        () => {
                    // Focus if already open, otherwise open fresh.
                    wp.os.registerWindow( {
                        id:     'jorvy',
                        title:  'Jorvy',
                        icon:   'dashicons-star-filled',
                        render: ( body ) => renderJorvy( body ),
                    } );
                },
            },
        ];
    }
);
```

The filter runs on every `/open` keystroke, so you can show/hide entries dynamically — e.g. only contribute your entry when the user has a specific capability:

```javascript
wp.hooks.addFilter( 'os.open-command.items', 'my-plugin/gate', ( items ) => {
    if ( ! openStationConfig.currentUserIsAdmin ) {
        return items;
    }
    return [ ...items, { id: 'admin-tools', label: 'Admin Tools', ... } ];
} );
```

---

## Recipe 5 — A command with structured autocomplete (`suggest`)

For commands whose arguments come from a finite list, define a `suggest()` function. The palette will render it under the input as the user types; ↑/↓ to navigate, Tab to fill, Enter to commit.

```javascript
wp.os.registerCommand( {
    slug:  'switch_theme',
    label: 'Switch theme',
    hint:  '[theme slug]',
    icon:  'dashicons-admin-appearance',

    // Suggestions are the static list of installed themes — loaded
    // once at registration time for this example.
    suggest: ( args ) => {
        const themes = openStationConfig.installedThemes || [];  // hypothetical
        const q = args.trim().toLowerCase();
        return themes
            .filter( ( t ) => t.name.toLowerCase().includes( q ) )
            .map( ( t ) => ( {
                value:       t.slug,
                label:       t.name,
                description: t.author,
                icon:        'dashicons-admin-appearance',
            } ) );
    },

    run: async ( slug, ctx ) => {
        await fetch( `/wp-json/my-plugin/v1/switch-theme/${ slug }`, {
            method: 'POST',
            headers: { 'X-WP-Nonce': openStationConfig.restNonce },
        } );
        ctx.close();
        return `Switched to **${ slug }**.`;
    },
} );
```

`suggest()` may also return a **Promise** of suggestions — useful when the list comes from a REST call (search users, posts, etc.). The assistant handles async cleanly: older in-flight `suggest()` results are discarded when the user types something new.

---

## Recipe 6 — `/close_all_windows` with confirm + protect-list

A destructive command that uses every plugin point: `ctx.confirm()` for the user prompt, `windowManager.closeAll()` for the batch op, and the `os.windows.close-all` filter so any plugin can keep specific windows alive.

```javascript
wp.os.ready( function () {
    wp.os.registerCommand( {
        slug:        'close_all_windows',
        label:       'Close all windows',
        description: 'Close every open window on every desktop.',
        icon:        'dashicons-dismiss',
        run: async ( _args, ctx ) => {
            const before = wp.os.windowManager.getAll().length;
            if ( before === 0 ) return 'No windows are open.';

            const ok = await ctx.confirm(
                'Close every open window?',
                'You\'ll lose any unsaved state inside iframe windows.'
            );
            if ( ! ok ) return 'Cancelled.';

            const closed = wp.os.windowManager.closeAll();
            ctx.close();
            return `Closed **${ closed }** window${ closed === 1 ? '' : 's' }.`;
        },
    } );
} );

// Optional protect-list — keep the OpenStation Preferences window alive.
wp.hooks.addFilter(
    'os.windows.close-all',
    'my-plugin/keep-os-settings',
    ( windows ) => windows.filter( ( w ) => w.id !== 'os-settings' )
);
```

`exceptIds` on the call site does the same thing:

```javascript
wp.os.windowManager.closeAll( { exceptIds: [ 'os-settings' ] } );
```

The difference is **scope**: `exceptIds` applies only to one call site; the filter applies to every batch close anywhere on the page.

---

## The `CommandContext` passed to `run`

| Method | What it does |
|---|---|
| `ctx.close()` | Dismiss the AI Assistant panel. |
| `ctx.openInWindow( url, title, icon? )` | Open a wp-admin URL in a legacy iframe window inside the desktop. |
| `ctx.confirm( message, details? )` | Prompt the user to confirm a destructive action. Returns `Promise<boolean>`. |

---

## Return-value shapes

| Return | Renders as |
|---|---|
| `undefined` / `void` | Nothing (silent success — use with `ctx.close()`) |
| `"a string"` | Chat bubble with the string as the message (markdown supported) |
| `{ message, answer_type?, admin_links?, entity? }` | Full AI-answer shape. `admin_links` render as clickable cards; `entity` as an entity card. |

---

## Behaviour & UX

- Thrown errors in `run` are caught automatically and rendered as an error bubble — your command can't crash the panel.
- Slugs must match `/^[a-z0-9_/-]+$/` (slashes allowed for `vendor/sub-id` namespacing) — invalid registrations log a console warning and are silently dropped.
- Re-registering the same slug replaces the previous definition (matches WordPress's `register_*` semantics).
- The palette list re-renders live when your plugin registers commands asynchronously (e.g. after a REST fetch).

---

## Related

- [JavaScript reference › `registerCommand`](../javascript-reference.md#registercommand-def---stable)
- [React to window events](./react-to-window-events.md) — for event-driven plugin UI that isn't a slash-command.
