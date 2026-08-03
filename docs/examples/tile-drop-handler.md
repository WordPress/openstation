# Accept drops on your desktop icon

Your plugin registers a desktop icon and you want the user to drag
things onto it — a photo onto an image editor, a post onto a publishing
tool, a file onto an uploader. This is how.

```php
defined( 'ABSPATH' ) || exit;
```

## The one thing that doesn't work

Registering your own `DropTarget` on the tile element:

```js
// ✗ Silently displaced.
wp.hooks.addAction( 'os.files.tile-rendered', 'my-plugin/drop', ( { tile } ) => {
    wp.os.dragManager.registerDropTarget( { element: tile, /* … */ } );
} );
```

Every non-folder tile carries a claimant that hard-rejects foreign
payloads, so a drop can't fall through to the wallpaper underneath —
it's what shows the red "Can't drop here" chip. The drop-target
registry allows **one target per element**, and the claimant is
installed after `tile-rendered` fires. Yours is overwritten before the
user ever drags anything.

## What does work

Cooperate with the claimant instead. It already consults a handler
registry for its accept predicate, its hover chip, and its drop —
register there and the layer does the rest.

```js
const off = wp.os.files.registerTilePayloadHandler( 'shortcut', {
    // Narrow: only my icon, nobody else's.
    appliesTo: ( { placement } ) => placement.file.ref === 'lienzo',

    // Which payloads I'll take. Return false and the user still gets
    // the normal rejection chip.
    accept: ( data ) => data.kind === 'attachment' || data.kind === 'post',

    // Shown next to the cursor while a matching payload hovers.
    acceptLabel: 'Open in Lienzo',

    onDrop: ( session ) => {
        const { kind, id, url, title } = session.payload.data;
        openLienzoWith( { kind, id, url, title } );
    },
} );

// Later, if your feature unmounts:
off();
```

## Payload types

`type` is the **drag payload's** type, not the file type:

| `type` | Dragged from |
|---|---|
| `'shortcut'` | Desktop icons, post/page references, dock-item promotions, site-window entity tiles |
| `'attachment'` | Media Library tiles and the site window's Media section |
| `'note'` | Pinned notes |

Register one handler per type you want to accept:

```js
[ 'shortcut', 'attachment' ].forEach( ( type ) =>
    wp.os.files.registerTilePayloadHandler( type, handler )
);
```

Inspect `session.payload.data` for the payload itself — its shape
depends on the source. Guard on what you actually need rather than
assuming a field is present.

## Sharing a type with other features

Several handlers can register the same type. Resolution is
**first-registered whose `appliesTo` matches**, so handlers only
compete when they claim the same tile for the same payload type.

That makes `appliesTo` the important part. Match on something that
identifies *your* icon:

```js
// ✓ Only my icon.
appliesTo: ( { placement } ) => placement.file.ref === 'lienzo',

// ✗ Claims every tile on the desktop, and shadows every handler
//   registered after mine.
appliesTo: () => true,
```

`placement.file` carries `type`, `ref`, `title`, `icon`, and
`shortcutUrl` — `ref` is the id you passed to
`openstation_register_icon()`.

## Feedback the user sees

- No matching handler → red "Can't drop here" chip, drop rejected.
- `appliesTo` matches but `accept` returns false → same rejection. Use
  this for "right icon, wrong thing".
- Both pass → your `acceptLabel` next to the cursor, tile highlights,
  `onDrop` runs on release.

## See also

- [JavaScript reference — `wp.os.files`](../javascript-reference.md#wpdesktopfiles--the-files-on-the-desktop-registry-experimental)
- [Files on the desktop](../files-on-desktop.md)
- [Register a desktop icon](../hooks-reference.md)
