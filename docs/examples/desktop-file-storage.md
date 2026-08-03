# Real file storage — react to uploads, gate policy, share from PHP

Recipes for the `upload` file type (real per-user desktop storage,
Experimental). Contract:
[files-on-desktop.md → Real file storage](../files-on-desktop.md#real-file-storage-upload--experimental).

## Grant desktop uploads to every OpenStation user

The default gate is WordPress's own `upload_files` capability
(Authors and up). A trusted intranet can open storage to everyone:

```php
add_filter( 'open_station_stored_files_upload_capability', static function () {
	return 'read'; // every logged-in openstation user
} );
```

## Enforce a per-user quota

```php
add_filter( 'open_station_stored_files_user_quota_bytes', static function ( $quota, $user_id ) {
	if ( user_can( $user_id, 'manage_options' ) ) {
		return 0; // admins: unlimited
	}
	return 200 * MB_IN_BYTES;
}, 10, 2 );
```

Over-quota uploads fail with `open_station_stored_files_quota_exceeded`.

## Allow a file type WordPress rejects by default

Additions here genuinely widen the policy — the framework keeps
core's `wp_check_filetype_and_ext()` re-check in agreement via a
scoped `upload_mimes` hook (a plain `mimes` override could only
narrow):

```php
add_filter( 'open_station_stored_files_allowed_mimes', static function ( $mimes ) {
	$mimes['stl'] = 'model/stl';
	$mimes['md']  = 'text/markdown';
	return $mimes;
} );
```

The executable denylist (`php*`, `phtml`, `phar`, dotfiles, …) still
applies on top and should stay that way.

## React to uploads and downloads

```php
add_action( 'open_station_stored_file_uploaded', static function ( $file_id, $placement_id, $user_id ) {
	$file = open_station_stored_files_get( $file_id );
	error_log( sprintf( 'user %d uploaded %s (%d bytes)', $user_id, $file['display_name'], $file['size_bytes'] ) );
}, 10, 3 );

// Download audit trail.
add_action( 'open_station_stored_file_downloaded', static function ( $file_id, $user_id ) {
	do_action( 'my_audit_log', 'file-download', compact( 'file_id', 'user_id' ) );
}, 10, 2 );
```

## Share a file from PHP

Single-file shares are read + download only, user principals only —
the invite/accept flow mirrors folder sharing:

```php
$share_id = open_station_stored_file_share_invite( $file_id, $owner_id, $recipient_user_id );
// Recipient's next heartbeat carries the invite; on accept the
// framework plants the tile at their desktop root.
```

Listen to the same actions folder shares fire — the row carries
`target_type => 'file'`:

```php
add_action( 'open_station_files_share_accepted', static function ( $share_id, $row ) {
	if ( 'file' === ( $row['target_type'] ?? 'folder' ) ) {
		// A stored file share was accepted.
	}
}, 10, 2 );
```

## Client-side: observe desktop-sink uploads

The desktop sink fires the same `os.drop.*` chain the
Media Library sink does:

```js
wp.os.hooks.addAction(
	'os.drop.after-upload',
	'my-plugin/uploads',
	( { result } ) => {
		if ( result && typeof result.storedFileId === 'number' ) {
			console.log( 'desktop upload landed', result.storedFileId, result.placement );
		}
	},
);
```

## Extend the preview pane (e.g. PDFs)

The folder-window preview pane renders images, video, and audio
uploads inline out of the box; other types show a no-preview note
plus a Download action. To preview a type the framework doesn't
handle, hook the (pre-existing) `os.files.preview` filter
and return your own element — it fully replaces the built-in for
that placement:

```js
wp.os.hooks.addFilter(
	'os.files.preview',
	'my-plugin/pdf-preview',
	( node, placement ) => {
		if (
			placement.file.type === 'upload' &&
			placement.file.mime === 'application/pdf'
		) {
			const host = document.createElement( 'div' );
			// Note: downloads are served with
			// `Content-Disposition: attachment`, so an <iframe> will
			// download rather than display. Fetch the bytes with
			// wp.os.fetch and hand them to a renderer such as
			// PDF.js instead.
			myPlugin.mountPdfViewer( host, placement.file.ref );
			return host;
		}
		return node; // Defer to the built-in for everything else.
	},
);
```

The serialized `upload` shape carries `mime`, `kind`
(`image | video | audio | pdf | archive | text | file`), and
`sizeBytes` to branch on.

## Server admins: nginx + backups

`.htaccess` protects the storage dir on Apache only. On nginx add:

```nginx
location ^~ /wp-content/uploads/os-files/ { deny all; }
```

The extensionless UUID disk names and the authenticated PHP-served
downloads are the effective floor either way. Back up the database
and `uploads/os-files/` together — the table maps names to
bytes.
