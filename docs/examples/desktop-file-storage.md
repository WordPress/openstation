# Real file storage — react to uploads, gate policy, share from PHP

Recipes for the `upload` file type (real per-user desktop storage,
Experimental). Contract:
[files-on-desktop.md → Real file storage](../files-on-desktop.md#real-file-storage-upload--experimental).

## Grant desktop uploads to every OpenStation user

The default gate is WordPress's own `upload_files` capability
(Authors and up). A trusted intranet can open storage to everyone:

```php
add_filter( 'openstation_stored_files_upload_capability', static function () {
	return 'read'; // every logged-in openstation user
} );
```

## Enforce a per-user quota

```php
add_filter( 'openstation_stored_files_user_quota_bytes', static function ( $quota, $user_id ) {
	if ( user_can( $user_id, 'manage_options' ) ) {
		return 0; // admins: unlimited
	}
	return 200 * MB_IN_BYTES;
}, 10, 2 );
```

Over-quota uploads fail with `openstation_stored_files_quota_exceeded`.

## Allow a file type WordPress rejects by default

Additions here genuinely widen the policy — the framework keeps
core's `wp_check_filetype_and_ext()` re-check in agreement via a
scoped `upload_mimes` hook (a plain `mimes` override could only
narrow):

```php
add_filter( 'openstation_stored_files_allowed_mimes', static function ( $mimes ) {
	$mimes['stl'] = 'model/stl';
	$mimes['md']  = 'text/markdown';
	return $mimes;
} );
```

The executable denylist (`php*`, `phtml`, `phar`, dotfiles, …) still
applies on top and should stay that way.

## React to uploads and downloads

```php
add_action( 'openstation_stored_file_uploaded', static function ( $file_id, $placement_id, $user_id ) {
	$file = openstation_stored_files_get( $file_id );
	error_log( sprintf( 'user %d uploaded %s (%d bytes)', $user_id, $file['display_name'], $file['size_bytes'] ) );
}, 10, 3 );

// Download audit trail.
add_action( 'openstation_stored_file_downloaded', static function ( $file_id, $user_id ) {
	do_action( 'my_audit_log', 'file-download', compact( 'file_id', 'user_id' ) );
}, 10, 2 );
```

## Into the Media Library — caption the copy, seed the post

"Add to Media Library" and "Start a post / page with this image"
copy the stored file into the Media Library once (idempotent per
file) and, for the post entries, start an `auto-draft` with the
attachment as its content. Three filters shape that:

```php
// Give the attachment a caption and description when it is copied.
add_filter( 'openstation_stored_file_media_post_data', static function ( $post_data, $row, $user_id ) {
	$post_data['post_excerpt'] = sprintf( 'From %s’s desktop', get_the_author_meta( 'display_name', $user_id ) );
	$post_data['post_content'] = 'Original file: ' . $row['display_name'];
	return $post_data;
}, 10, 3 );

// Put a heading above the image in every post started from a file.
add_filter( 'openstation_stored_file_start_post_content', static function ( $content, $attachment_id, $post_type ) {
	if ( 'post' !== $post_type ) {
		return $content;
	}
	return '<!-- wp:heading --><h2 class="wp-block-heading">Photo of the day</h2><!-- /wp:heading -->' . $content;
}, 10, 3 );

// Start pages as real drafts instead of auto-drafts.
add_filter( 'openstation_stored_file_start_post_args', static function ( $args, $attachment_id, $post_type ) {
	if ( 'page' === $post_type ) {
		$args['post_status'] = 'draft'; // survives an abandoned editor
	}
	return $args;
}, 10, 3 );
```

To keep a type out of the Media Library even though WordPress would
accept it — or to let one in — decide per row:

```php
add_filter( 'openstation_stored_file_is_media', static function ( $is_media, $row ) {
	return $is_media && 'application/zip' !== $row['mime'];
}, 10, 2 );
```

And react once the copy or the post exists:

```php
add_action( 'openstation_stored_file_post_started', static function ( $post_id, $attachment_id, $file_id, $user_id ) {
	wp_set_post_tags( $post_id, array( 'from-desktop' ), true );
}, 10, 4 );
```

Dropping media uploads on a post tile appends them as blocks. To
wrap several dropped images in a gallery instead of one image block
each:

```php
add_filter( 'openstation_stored_file_attach_content', static function ( $markup, $attachment_ids ) {
	$images = array_filter( $attachment_ids, 'wp_attachment_is_image' );
	if ( count( $images ) < 2 ) {
		return $markup;
	}
	$inner = implode( '', array_map( static function ( $id ) {
		return sprintf(
			'<!-- wp:image {"id":%1$d,"sizeSlug":"large"} --><figure class="wp-block-image size-large"><img src="%2$s" alt="" class="wp-image-%1$d"/></figure><!-- /wp:image -->',
			$id,
			esc_url( wp_get_attachment_image_url( $id, 'large' ) )
		);
	}, $images ) );
	return '<!-- wp:gallery {"linkTo":"none"} --><figure class="wp-block-gallery has-nested-images columns-default is-cropped">' . $inner . '</figure><!-- /wp:gallery -->';
}, 10, 2 );
```

## Share a file from PHP

Single-file shares are read + download only, user principals only —
the invite/accept flow mirrors folder sharing:

```php
$share_id = openstation_stored_file_share_invite( $file_id, $owner_id, $recipient_user_id );
// Recipient's next heartbeat carries the invite; on accept the
// framework plants the tile at their desktop root.
```

Listen to the same actions folder shares fire — the row carries
`target_type => 'file'`:

```php
add_action( 'openstation_files_share_accepted', static function ( $share_id, $row ) {
	if ( 'file' === ( $row['target_type'] ?? 'folder' ) ) {
		// A stored file share was accepted.
	}
}, 10, 2 );
```

Who else can read a file is the owner's call:
`openstation_stored_file_user_can_read()` answers yes for the owner,
an accepted file share, or read access to a folder holding a live
placement **by the owner**. A recipient who files the tile into a
folder of their own does not widen it. Widen it yourself through
`openstation_stored_file_can_read`.

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
