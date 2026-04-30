# Replace the dock submenu popover

> **Where this fits.** Dock customization has three layers — see
> [the overview](../dock-customization.md). This page covers the
> middle layer: replacing the right-click popover. It composes with
> whichever rail renderer the user has active.
>
> | If you want to… | Use… |
> |---|---|
> | Add classNames, wrap tiles, animate them in | [Decoration hooks](./dock-decoration-hooks.md) |
> | Replace the right-click submenu popover | **Submenu renderer** *(this page)* |
> | Replace the entire rail (ring, stack, etc.) | [Rail renderer](./dock-rail-renderer.md) |

Right-clicking a dock tile that has admin submenu items opens a popover
listing those links. The shipped renderer is a vertical list — fine,
but easy to make more interesting. This example shows two paths:

1. **Style overrides** — keep the default renderer, restyle via CSS or
   the [decoration hooks](./dock-decoration-hooks.md). Cheap.
2. **Full replacement** — register a custom renderer that owns the
   popover DOM. This is the framework's "all in" path.

Replacement is the focus here.

**Status:** Stable since 0.18.0. The renderer interface is versioned
(`apiVersion: 1`); a renderer that doesn't speak the current version
is rejected at registration so an out-of-date plugin can't stand on a
load-bearing bug.

## The renderer contract

```ts
interface SubmenuRenderer {
    id: string;                // 'default' | 'arc' | 'cards' | …
    label: string;             // shown in OS Settings → Appearance → Submenu style
    description?: string;      // 1-line preview text
    icon?: string;             // dashicon for the picker
    apiVersion?: 1;            // omit to match the current contract
    owner?: string;            // for live unregistration on plugin deactivation
    mount( deps: SubmenuMountDeps ): SubmenuController;
}

interface SubmenuMountDeps {
    item:        DockItem;                       // parent tile data
    anchor:      HTMLElement;                    // the dock tile element
    orientation: 'left' | 'right' | 'bottom';    // which edge the parent dock hugs
    onPick:      ( submenu: SubmenuItem ) => void;
    onClose:     () => void;
}

interface SubmenuController {
    close():   void;   // animated dismiss; use for outside-click / Escape
    destroy(): void;   // immediate teardown; called by the shell on layout change / dock destroy
}
```

`mount()` builds and shows the popover, returns the controller. The
shell calls `controller.close()` for animated dismiss (Escape, outside
click, submenu pick) and `controller.destroy()` for unconditional
teardown (dock layout switch, shell unload).

The renderer **never** opens windows directly — call `onPick()` and
the dock routes the chosen submenu link through the same code path
the regular tile click uses (so submenus land in the right window
with the in-window tab strip wired correctly).

## Minimal replacement: a "cards" renderer

Hovering each menu item in your custom popover gets a card-style
preview. Mounted as a fixed-position panel anchored to the dock tile.

```js
wp.desktop.ready( () => {
    wp.desktop.registerSubmenuRenderer( {
        id:    'my-cards',
        label: 'Cards',
        description: 'Hovering preview cards instead of a list.',
        icon:  'dashicons-grid-view',
        owner: 'my-plugin',          // for live un-registration on deactivation
        mount( { item, anchor, orientation, onPick, onClose } ) {
            const root = document.createElement( 'div' );
            root.className = 'my-cards';
            root.setAttribute( 'role', 'menu' );

            for ( const sub of item.submenu ) {
                const card = document.createElement( 'button' );
                card.type = 'button';
                card.setAttribute( 'role', 'menuitem' );
                card.className = 'my-cards__card';
                card.textContent = sub.title;
                card.addEventListener( 'click', () => onPick( sub ) );
                root.appendChild( card );
            }

            // Position the panel against the anchor. Read the dock
            // tile's bounding rect; place the panel above it for
            // bottom-orientation docks, beside it for vertical docks.
            const a = anchor.getBoundingClientRect();
            root.style.position = 'fixed';
            if ( orientation === 'bottom' ) {
                root.style.left = `${ a.left + a.width / 2 }px`;
                root.style.top  = `${ a.top - 12 }px`;
                root.style.transform = 'translate(-50%, -100%)';
            } else {
                root.style.left = `${ a.right + 12 }px`;
                root.style.top  = `${ a.top + a.height / 2 }px`;
                root.style.transform = 'translateY(-50%)';
            }
            document.body.appendChild( root );

            // Outside-click dismissal — the shell does NOT install
            // this for you. Capture phase so card clicks fire onPick
            // before this handler runs.
            const onPointer = ( e ) => {
                if ( root.contains( e.target ) || anchor.contains( e.target ) ) {
                    return;
                }
                onClose();
            };
            document.addEventListener( 'pointerdown', onPointer, true );

            return {
                close() {
                    root.classList.add( 'my-cards--closing' );
                    setTimeout( () => this.destroy(), 200 );
                },
                destroy() {
                    document.removeEventListener( 'pointerdown', onPointer, true );
                    root.remove();
                },
            };
        },
    } );
} );
```

After registration the renderer is **available** in OS Settings →
Appearance → Submenu style. The user picks it once; the choice is
persisted to user meta and applied across page loads. To make it the
default for a fresh install, register with `id: 'default'` — the
registry replaces the shipped baseline.

## Live registration on plugin activation

If your renderer ships in its own JS bundle, the shell loads scripts
the same way it does for commands and OS Settings tabs — register
with the matching `owner: '<your-script-handle>'` and the shell will
unregister the renderer automatically when the plugin is deactivated
mid-session.

```php
// In your plugin PHP — load your renderer script alongside your other
// shell-side assets. Once 0.18+ ships the dedicated registration
// helper (`wp_desktop_register_submenu_renderer_script`) you can opt
// in to live-registration; until then, enqueue when the shell loads
// and rely on `wp.desktop.ready()` for the registration timing.
add_action( 'wp_desktop_shell_assets', function () {
    wp_enqueue_script(
        'my-submenu-renderer',
        plugin_dir_url( __FILE__ ) . 'assets/submenu-renderer.js',
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
} );
```

## Composability with decoration hooks

The renderer owns the popover DOM, but the **rail** still fires the
[decoration hooks](./dock-decoration-hooks.md). A plugin author who
wants both — say, a custom popover **and** a glow effect on the dock
tile that's currently expanded — uses the renderer's `onClose` /
`onOpen` callbacks to toggle a className on the anchor and listens
for `wp-desktop.dock.tile-rendered` to apply the glow CSS.

The renderer registry and decoration hooks are deliberately separate
surfaces so they compose orthogonally.
