# Group the dock your way — custom decks

> **Where this fits.** Dock customization has layers — see
> [the overview](../dock-customization.md). This page covers the one
> that decides *which tiles are on screen*.
>
> | If you want to… | Use… |
> |---|---|
> | Change which tiles are grouped together, and how they're named | **Decks** *(this page)* |
> | Add classNames, wrap tiles, animate them in | [Decoration hooks](./dock-decoration-hooks.md) |
> | Replace the entire rail (ring, stack, etc.) | [Rail renderer](./dock-rail-renderer.md) |

A bottom dock is a pill, and a pill has a width. Rather than pushing
its overflow into a hidden horizontal scroll — tiles that exist only
for people who know to swipe — the rail can fold itself into **decks**
and show one at a time, with a tab strip at its leading edge naming
the one you're on.

Four ship: `favorites` (whatever the user has starred), `wordpress`
(core admin menus), `apps` — which the shell labels *Plugins* — and
`station` (system tiles: OpenStation Preferences, the recycle bin,
plugin-owned native windows, Exit OpenStation). The list is a filter,
so all of it is yours.

**Decks are opt-in** — `dockDecksEnabled`, off by default, in
OpenStation Preferences → Appearance → Dock groups. Your filter still
runs when they're off (the rail asks on every partition pass either
way), it just has nothing to paint. Don't turn the setting on for the
user from a plugin.

**Status:** Stable.

## The surface

| Hook | Kind | Signature |
|---|---|---|
| `os.dock.decks` | Filter | `( decks: DockDeck[], ctx: DockHookContextBase ) => DockDeck[]` |
| `os.dock.deck-changed` | Action | `( ctx: DockHookContextBase & { deckId, previousDeckId, reason } ) => void` |

```typescript
interface DockDeck {
    id: string;        // stable; persisted, and written to each tile's data-os-deck
    label: string;     // tab label and accessible name
    icon: string;      // dashicons class, or a URL / data: URI painted as a mask
    order: number;     // lower is closer to the leading edge
    matchItem?:   ( item: DockItem ) => boolean;
    matchSystem?: ( item: SystemDockItem ) => boolean;
}
```

Four rules govern the result:

1. **A tile joins the first deck that claims it**, in `order` order. A
   narrow deck registered at a low `order` therefore wins its tiles
   without you having to rewrite anyone else's predicate. This is how
   the built-in `favorites` deck (order 5) takes a starred tile out of
   `apps` (order 20) without either predicate knowing about the other.
2. **A deck that matches nothing is dropped.** No error, no empty tab.
3. **Fewer than two live decks means no decks at all** — the strip is
   removed and every tile is on screen, exactly as an undecked rail.
4. **Bottom rails only.** A left or right rail is a column with the
   shell's full height to spend and scrolls honestly, so it is never
   decked and your filter simply never runs for it.

The filter runs on every partition pass — boot, every live menu refresh,
and every system tile arriving or leaving — so keep it cheap and pure.

## Give your plugin its own deck

The common case: your plugin registers several admin menus and you'd
rather they lived together than scattered through Plugins.

```php
add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'my-plugin-deck',
        plugins_url( 'deck.js', __FILE__ ),
        array( 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

```js
// deck.js
wp.hooks.addFilter( 'os.dock.decks', 'my-plugin/deck', ( decks ) => [
    ...decks,
    {
        id: 'my-shop',
        label: 'Shop',
        icon: 'dashicons-cart',
        // Between WordPress (10) and Plugins (20) — the shop reads as a
        // first-class area of this site, not as one more plugin.
        order: 15,
        matchItem: ( item ) =>
            item.id.startsWith( 'woocommerce' ) ||
            item.id === 'edit.php?post_type=product',
    },
] );
```

Because the shop deck sorts ahead of `apps`, it takes those menus off
the Plugins deck automatically. Nothing else has to change.

## Rename a built-in

```js
wp.hooks.addFilter( 'os.dock.decks', 'my-plugin/rename', ( decks ) =>
    decks.map( ( deck ) =>
        deck.id === 'apps' ? { ...deck, label: 'Add-ons' } : deck
    )
);
```

**Keep the `id`.** It is what the user's remembered pick is stored
under, so changing it silently resets everyone to the leading deck —
which is exactly why the shell's own *Apps → Plugins* relabel moved
the `label` and left `apps` alone.

## Turn decks off

Return an empty list. The rail goes back to one undivided row with its
old horizontal scroll — which is the supported way for a theme to opt
out.

```js
wp.hooks.addFilter( 'os.dock.decks', 'my-theme/no-decks', () => [] );
```

## React to the deck changing

```js
wp.hooks.addAction( 'os.dock.deck-changed', 'my-plugin/track', ( ctx ) => {
    // ctx.reason tells you WHO changed it:
    //   'click' | 'keyboard' | 'wheel' | 'swipe' — the user did
    //   'restore' — the rail resolving a deck without being asked
    //               (boot, or a deactivation emptying the active one)
    //   'auto'    — the follow-focus preference, on the user's behalf
    if ( ctx.reason === 'restore' ) {
        return;
    }
    console.log( `${ ctx.rail }: ${ ctx.previousDeckId } → ${ ctx.deckId }` );
} );
```

And to drive it:

```js
wp.os.dock?.setActiveDeck( 'my-shop' );
wp.os.dock?.getActiveDeck();   // 'my-shop' | 'wordpress' | … | null
```

Both are no-ops on a rail that isn't decked, so neither needs a layout
check around it — `getActiveDeck()` returns `null` there.

## Seed a starred set

`dockFavorites` is a plain ordered list of canonical item ids, and it
is writable through the public settings writer — so a plugin that
knows what its users reach for can offer to set it up. The write
repaints the rail synchronously; no reload.

```js
const snap = wp.os.getOsSettings();
wp.os.updateOsSettings( {
    dockFavorites: [ ...snap.dockFavorites, 'edit.php', 'my-plugin' ],
} );
```

Append rather than replace unless the user explicitly asked for a
reset — the order is theirs, and the Favorites deck renders in it.
The same list is what the tile right-click menu's *Add to favorites* /
*Remove from favorites* entry writes — an entry every icon in the dock
carries, system tiles included, whether or not decks are switched on.

Your own system tiles are starrable the moment you register them; ids
in `dockFavorites` are matched against `SystemDockItem.id` and
`DockItem.id` alike, so nothing extra is needed on your side.

## Two things worth knowing

**A hidden deck still speaks.** Its tab carries an indicator dot when
one of its tiles has an open window, and the sum of its tiles' badges
as a number. Folding a group away must not fold away what it was
telling the user, so if you add a deck you get this for free — and if
you set badges with `wp.os.dock.setBadge()`, they roll up without any
extra work on your side.

**A custom rail renderer opts out.** Decks are painted by the shipped
`Dock` class; a renderer registered through
`wp.os.registerDockRailRenderer` replaces that class entirely, so it
owns its own grouping. Your `os.dock.decks` filter will not run for it.

## See also

- [Dock customization overview](../dock-customization.md) — how decks,
  decoration hooks and rail renderers compose.
- [JavaScript Reference → Dock decks](../javascript-reference.md#dock-decks)
  — every shape and every value.
- [Desktop themes → Dock glyphs](../desktop-themes.md#dock-glyphs) —
  `--os-dock-deck-fill` / `--os-dock-deck-ink`, the two tokens that
  repaint the active tab.
