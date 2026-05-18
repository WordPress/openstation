# OS-file drop

**Status:** Experimental · **Since:** 0.30.0

Desktop Mode catches files dragged from the host operating system
(macOS Finder, Windows Explorer, Linux Nautilus) onto **any**
surface in the shell — the wallpaper, a folder window, a native
window, or a chromeless admin iframe — and routes them through
a confirmation dialog before uploading to the Media Library.

The dialog opens with every field pre-filled (`title`, `alt_text`,
`caption`, `description`, `filename`) but every field is editable
before upload.

## What the user sees

1. Drag a file from Finder onto any part of Desktop Mode.
2. A subtle blue overlay confirms the drop target. Files outside
   the allowed-MIMEs list (which mirrors `get_allowed_mime_types()`
   for the current user) are toasted as rejected on release.
3. A `<wpd-modal>` opens listing every accepted file with its
   default metadata.
4. The user edits whatever they like and clicks **Upload**. Each
   file is `POST`ed to `wp/v2/media` as multipart form-data with
   `file`, `title`, `alt_text`, `caption`, `description` in a
   single round-trip — no half-attached media on partial failure.

## Plugin hook surface

Every step in the pipeline fires a hook (`addFilter` / `addAction`
on `window.wp.hooks`). All hook names live on
`wp.desktop.HOOKS.FILE_DROP_*` (re-exported from
`src/os-file-drop/hooks.ts`).

| Hook | Kind | Payload |
| --- | --- | --- |
| `desktop-mode.drop.files-detected` | filter | `(files: File[], ctx: DropContext) => File[]` — before mime/size filter. Return `[]` to abort silently. |
| `desktop-mode.drop.files-rejected` | action | `{ rejections: DropRejection[], context: DropContext }` — files that failed the allow-list. |
| `desktop-mode.drop.dialog-fields` | filter | `(entry: DropFileEntry, ctx) => DropFileEntry` — mutate the per-file defaults the dialog shows. |
| `desktop-mode.drop.before-upload` | filter | `({ file, mime, fields }, ctx) => payload \| null` — last chance to swap the file or cancel (returning `null`). |
| `desktop-mode.drop.upload-started` | action | _Since 0.31.0._ `{ file, fields, context, abort: () => void }` — XHR is open and about to `send()`. Call `abort()` to cancel mid-flight; the manager will reject with `UploadAbortedError`. |
| `desktop-mode.drop.upload-progress` | action | _Since 0.31.0._ `{ file, fields, context, loaded, total, indeterminate }` — per `XMLHttpRequestUpload.progress` tick. A synthetic 100% event is fired on `upload.load`. |
| `desktop-mode.drop.after-upload` | action | `{ file: File, result: DropUploadResult, fields, context }` — `file` (since 0.31.0) carries the same `File` ref as `upload-started`, so per-file UI can match by identity. |
| `desktop-mode.drop.upload-failed` | action | `{ file, error, context }` — `file` is the post-`before-upload` identity, same as the other lifecycle hooks. `error.name === 'UploadAbortedError'` for a caller-cancelled upload. |

`DropContext.surface` is one of `'wallpaper' | 'window' |
'folder' | 'iframe' | 'unknown'`. `windowId` is populated when
the drop happened over a window or an iframe.

## Server-side filters

Both filters fire in `includes/render/assets.php` while the shell
config blob is being built.

```php
// Narrow the allow-list — e.g. images only.
add_filter(
    'desktop_mode_drop_allowed_mimes',
    function ( $mimes_map ) {
        return array_filter(
            $mimes_map,
            static fn ( $mime ) => str_starts_with( $mime, 'image/' )
        );
    }
);

// Tighten the per-file size cap for a specific role.
add_filter(
    'desktop_mode_drop_max_size',
    function ( $max, $user_id ) {
        $user = get_userdata( $user_id );
        if ( $user && in_array( 'editor', $user->roles, true ) ) {
            return 20 * 1024 * 1024; // 20 MB
        }
        return $max;
    },
    10,
    2
);
```

## Recipe: stamp the active folder onto every upload

Capture which folder the user dropped into (so the Files-on-Desktop
plugin can place the new attachment there) by reading
`DropContext.windowId` in the `before-upload` filter and tagging
the multipart payload yourself.

```js
import { FILE_DROP_HOOKS } from '@wp-desktop-mode/os-file-drop';

wp.hooks.addFilter(
    FILE_DROP_HOOKS.BEFORE_UPLOAD,
    'my-plugin/stamp-folder',
    ( payload, ctx ) => {
        if ( ctx.surface !== 'folder' && ctx.surface !== 'window' ) {
            return payload;
        }
        // Decorate description with a folder hint our REST listener
        // strips back out on save.
        return {
            ...payload,
            fields: {
                ...payload.fields,
                description: `${ payload.fields.description }
[folder:${ ctx.windowId }]`.trim(),
            },
        };
    }
);
```

## Recipe: hand a CSV drop off to a different importer

Returning `null` from `before-upload` cancels the manager's
`wp/v2/media` round-trip — useful when your plugin owns the
endpoint that should handle that file type.

```js
wp.hooks.addFilter(
    FILE_DROP_HOOKS.BEFORE_UPLOAD,
    'my-plugin/csv-importer',
    ( payload, ctx ) => {
        if ( payload.mime !== 'text/csv' ) {
            return payload;
        }
        void importCsv( payload.file, ctx );
        return null;
    }
);
```

## Showing upload progress

A floating HUD ships with the shell — bottom-right, one row per
in-flight upload, each row carrying a `<wpd-progress-bar>` plus a
Cancel button that calls the `abort()` handle from
`upload-started`. The HUD subscribes to the four hooks above and is
the canonical consumer; plugins that want a different UI can:

1. Set `data-desktop-mode-suppress-upload-hud` on `<body>` before
   the shell boots to disable the default panel.
2. Subscribe to `upload-started` / `upload-progress` /
   `after-upload` / `upload-failed` to drive a custom UI.

Minimal example — a per-window in-iframe progress bar:

```js
import { FILE_DROP_HOOKS } from '@wp-desktop-mode/os-file-drop';

const bars = new Map(); // file → <wpd-progress-bar>

wp.hooks.addAction(
    FILE_DROP_HOOKS.UPLOAD_STARTED,
    'my-plugin/progress',
    ( { file, fields } ) => {
        const bar = document.createElement( 'wpd-progress-bar' );
        bar.setAttribute( 'label', fields.filename );
        bar.setAttribute( 'show-percent', '' );
        bar.setAttribute( 'indeterminate', '' );
        document.querySelector( '#uploads' ).appendChild( bar );
        bars.set( file, bar );
    }
);

wp.hooks.addAction(
    FILE_DROP_HOOKS.UPLOAD_PROGRESS,
    'my-plugin/progress',
    ( { file, loaded, total, indeterminate } ) => {
        const bar = bars.get( file );
        if ( ! bar ) return;
        if ( indeterminate || total <= 0 ) {
            bar.setAttribute( 'indeterminate', '' );
        } else {
            bar.removeAttribute( 'indeterminate' );
            bar.setAttribute( 'max', String( total ) );
            bar.setAttribute( 'value', String( loaded ) );
        }
    }
);

wp.hooks.addAction(
    FILE_DROP_HOOKS.AFTER_UPLOAD,
    'my-plugin/progress',
    ( { file } ) => {
        // Match on the `File` reference itself — two drops of
        // `photo.jpg` from different folders would otherwise route
        // each other's success event to the wrong row.
        const bar = bars.get( file );
        if ( ! bar ) return;
        bar.setAttribute( 'tone', 'success' );
        bars.delete( file );
    }
);
```

`<wpd-progress-bar>` is documented in `docs/examples/progress-bar.md`.

## Hooks reference

See [`docs/hooks-reference.md`](../hooks-reference.md) for the
authoritative list, including the PHP-side
`desktop_mode_drop_allowed_mimes` and `desktop_mode_drop_max_size`
filters.
