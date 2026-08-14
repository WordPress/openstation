# Window links — relate windows and restyle the ties *(Experimental)*

Open a post and two of its comments in three windows and the desktop draws **splines terminated by circular dots** from each comment window to the post window — the **larger dot** sits on the window the content *belongs to* (dots are rotation-invariant, so a tie meeting a border at any angle looks right — arrowheads read wrong on skewed approaches). Two open posts whose contents hyperlink each other get a **single spline with large dots on both ends**. Focusing a window **raises the windows directly tied to it** (they surface just below the focused one, without stealing focus): the root pulls up all of its children; a child pulls up its parent, not its siblings. The splines lift along with them so no unrelated window covers them, and every relative is marked with an accent outline plus a soft glow. The user tunes all of this in two places: **OpenStation Preferences → Features → Window links** (master on/off, bring-related-to-front, highlight-related) and **OpenStation Preferences → Windows → Window links** (link style; show *always* — the default — / *when focused* / *off*).

Core content relates automatically: post/page/CPT editors announce themselves as roots — plus, as outbound references, the posts their content hyperlinks, the media embedded in their content (`wp-image-{id}`, which catches inserted-but-never-attached images), their featured image, and their assigned categories/tags (`term/{taxonomy}`). Comment-edit screens, attached-media screens (both the classic editor and the `upload.php?item=N` grid detail), arrive pre-rooted at their parent post, and term edit screens (`term.php`) are roots that assigned posts point at — all resolved server-side by the chromeless bridge, since the URL alone can't answer "which post does comment 45 belong to".

**Direction semantics** — one deliberate reading, applied everywhere: **the edge points at the thing its source belongs to or refers to** (relational structure — never "which window opened which"). The engine derives typed, directed edges from the identities; the built-in renderer encodes the direction as dot size (larger dot on the target):

| Edge kind | Derived from | Endpoint dots |
|---|---|---|
| `child-root` | a ref with `root` pointing at an open root window | large dot at the root — *comment → post* |
| `child-root` | a `links` entry with `rel: 'child'` (the declarer announces something that belongs to IT — a post's embedded/featured media, which only the post knows about) | large dot at the DECLARER — *media → post* |
| `reference` | a plain `links` entry (`rel` omitted / `'references'`) | large dot at the referenced window — *post → term*, *post A → post B (hyperlink)* |
| `reference` + `bidirectional: true` | two windows referencing each other (merged into one edge) | large dots at both ends |

The two `child-root` rows are the same visible relationship expressed from either side — attached media roots itself at the post; merely-inserted media is declared by the post via `rel: 'child'`. Both draw *media → post*, so the direction never flips over an invisible technicality like attachment state.

Three extension surfaces, smallest first.

## 1. Declare relations for your own windows (JS)

Any window can carry a **content identity**. A ref *without* `root` IS a root; a ref *with* `root` joins that root's group as a child. Namespace your `type` (`vendor/sub-type`).

```javascript
// At open time, on the window config…
wp.os.registerWindow( {
    id: 'acme-order-77',
    title: 'Order #77',
    render: renderOrder,
    content: { type: 'acme/order', id: 77, root: { type: 'acme/customer', id: 12 } },
} );

// …or any time later:
wp.os.relations.set( 'acme-customer-12', { type: 'acme/customer', id: 12 } );
```

The moment both windows are open, the tie draws — no further wiring. Query and react:

```javascript
wp.os.relations.groups();            // → [ { key: 'acme/customer:12', rootWindowIds, children } ]
wp.os.relations.edges();             // → [ { fromWindowId, toWindowId, kind, bidirectional } ]
wp.os.relations.related( windowId ); // → tied window ids (group members + reference endpoints)

document.addEventListener( 'os-window-link-groups-changed', ( e ) => {
    console.log( 'relations changed:', e.detail.groups );
} );
```

To tie two windows without a parent/child hierarchy, use `links` — mutual links render as one bidirectional tie (large dots at both ends):

```javascript
wp.os.relations.set( windowA, { type: 'post', id: 1, links: [ { type: 'post', id: 2 } ] } );
wp.os.relations.set( windowB, { type: 'post', id: 2, links: [ { type: 'post', id: 1 } ] } );
```

## 2. Announce identity for your own admin screen (PHP)

Iframe windows get their identity from the chromeless bridge. Add your screen via the `openstation_window_content_identity` filter — it runs in real admin context, so you can resolve parents the URL doesn't carry:

```php
add_filter( 'openstation_window_content_identity', function ( $identity, $screen ) {
    if ( $screen && 'acme_order_page' === $screen->id && isset( $_GET['order'] ) ) {
        $order = acme_get_order( absint( $_GET['order'] ) );
        if ( $order ) {
            return array(
                'type'  => 'acme/order',
                'id'    => $order->id,
                'label' => $order->title,
                'root'  => array( 'type' => 'acme/customer', 'id' => $order->customer_id ),
            );
        }
    }
    return $identity;
}, 10, 2 );
```

Return `null` to suppress detection for a screen. The bridge re-announces on every iframe navigation, so identities never go stale.

## 3. Replace the renderer — draw the ties your way

The default `svg-splines` renderer registers through the same public API yours will use. One renderer is active at a time; the user picks it in OpenStation Preferences.

```javascript
wp.os.registerWindowLinkRenderer( {
    id: 'acme/dotted-lines',
    label: 'Dotted lines',
    description: 'Straight dotted connectors between related windows.',
    owner: 'acme-link-renderer', // script handle → live-unregister on deactivation
    mount: ( ctx ) => {
        const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
        svg.style.width = svg.style.height = '100%';
        ctx.container.appendChild( svg );

        const draw = ( frame ) => {
            svg.replaceChildren();
            // frame.edges already encodes direction + bidirectional
            // merging — iterate it rather than re-deriving from groups.
            for ( const edge of frame.edges ) {
                if ( ! edge.from || ! edge.to ) {
                    continue; // null rect = minimized / split view / other desktop
                }
                const line = document.createElementNS( svg.namespaceURI, 'line' );
                line.setAttribute( 'x1', edge.from.x + edge.from.width / 2 );
                line.setAttribute( 'y1', edge.from.y + edge.from.height / 2 );
                line.setAttribute( 'x2', edge.to.x + edge.to.width / 2 );
                line.setAttribute( 'y2', edge.to.y + edge.to.height / 2 );
                line.setAttribute( 'stroke', 'var(--os-window-link-color)' );
                line.setAttribute( 'stroke-dasharray', edge.kind === 'reference' ? '4 4' : '' );
                // edge.bidirectional / edge.focused are yours to style —
                // the built-in uses <marker> endpoint dots and an active class.
                svg.appendChild( line );
            }
        };

        const off = ctx.onFrame( draw ); // rAF-coalesced: live drag/resize + membership changes
        draw( ctx.getFrame() );
        return () => {
            off();
            svg.remove();
        };
    },
} );
```

`ctx.container` is the shell's link layer — absolutely positioned over the desktop, `pointer-events: none`, stacked **behind** the windows. You own its children; return a teardown that removes them.

**Canvas / PixiJS sketch** — pull instead of push: append your `<canvas>` to `ctx.container`, run your own ticker, and read `ctx.getFrame()` per tick.

```javascript
wp.os.registerWindowLinkRenderer( {
    id: 'acme/pixi-links',
    label: 'Pixi links',
    mount: async ( ctx ) => {
        await wp.os.loadModules( [ 'pixijs' ] ); // shared vendor loader — see content-graph
        const app = new window.PIXI.Application();
        await app.init( { backgroundAlpha: 0, resizeTo: ctx.container } );
        ctx.container.appendChild( app.canvas );

        const g = new window.PIXI.Graphics();
        app.stage.addChild( g );
        app.ticker.add( () => {
            g.clear();
            for ( const edge of ctx.getFrame().edges ) {
                /* …stroke your curve from edge.from to edge.to,
                   endpoint markers per edge.kind / edge.bidirectional… */
            }
        } );
        return () => app.destroy( true );
    },
} );
```

### Load it live on plugin activation (PHP)

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'acme-link-renderer',
        plugins_url( 'js/link-renderer.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'acme-link-renderer' );
} );
openstation_register_window_link_renderer_script( 'acme-link-renderer' );
```

Your renderer appears in the OpenStation Preferences selector the moment the plugin activates — no reload. With `owner` set (above), deactivation live-unregisters it; if it was the active pick, the shell falls back to `svg-splines`.

## Styling knobs

The built-in splines read CSS custom properties — restyle without replacing the renderer: `--os-window-link-color`, `--os-window-link-color-active` (focused group), `--os-window-link-width`, `--os-window-link-accent` (the related-window outline stamped as `os-window--linked`), and `--os-window-link-glow` (the soft halo behind those windows — a literal color-with-alpha, not a `color-mix()`, so a failed resolve can't invalidate the composed box-shadow).

## Related

- [`javascript-reference.md`](../javascript-reference.md) — `wp.os.relations`, `registerWindowLinkRenderer`, frame shapes, events, JS filters (including `os.window-links.content` to rewrite identities and `os.window-links.renderer` to force-swap the active renderer).
- [`hooks-reference.md`](../hooks-reference.md) — `openstation_window_content_identity`, `openstation_register_window_link_renderer_script()`.
- [`bridge-protocol.md`](../bridge-protocol.md) — the `os-content-identity` message.
