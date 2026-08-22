# Code Blue — register your plugin's log file

The Code Blue window tails the WP debug log and the PHP error log out of the box. If your plugin writes its own log file, one filter puts it in the window's source picker — parsed, charted, and grouped like every other source:

```php
add_filter( 'openstation_code_blue_log_sources', function ( $sources ) {
	$upload_dir = wp_upload_dir();

	$sources[] = array(
		'id'    => 'my-plugin-log',
		'label' => __( 'My Plugin log', 'my-plugin' ),
		'path'  => trailingslashit( $upload_dir['basedir'] ) . 'my-plugin/debug.log',
	);

	return $sources;
} );
```

That's the whole descriptor — `id` (slug), `label`, `path` (absolute). File metadata (`exists`, `readable`, `writable`, `size`, `mtime`) is derived server-side after filtering; a missing file shows up grayed out in the picker rather than erroring.

The parser understands standard `error_log()` output — `[22-Aug-2026 09:14:02 UTC] …` timestamps, PHP error labels, stack traces, and `WordPress database error` lines. Plain custom lines come through as one `info` entry per line, so a log of your own making is still searchable and groupable. Two format caveats:

- **Charting needs timestamps.** Lines written with `error_log( $msg, 3, $path )` carry no timestamp prefix, so they list and group but can't be placed on the histogram. Prepend the standard `[d-M-Y H:i:s T]` prefix when writing if you want your entries charted.
- **Other formats can bring their own parser.** If your file is Monolog- or ISO-formatted, hook `openstation_code_blue_entries` — you get the raw scanned tail plus your source descriptor, and return your own entry array (build entries with `openstation_code_blue_make_entry()`).

Two things to know:

- **The window is developer-mode, admin-only.** Code Blue only registers when the user has Developer mode on in OpenStation Preferences AND `manage_options` (`manage_network_options` on multisite) — the same `openstation_code_blue_user_can_use` gate covers every source you register. Don't register a file whose content an administrator shouldn't see, because they will.
- **"Clear log" truncates your file.** If the file is writable, the window offers to clear it. React if you need to:

```php
add_action( 'openstation_code_blue_log_cleared', function ( $id, $path ) {
	if ( 'my-plugin-log' === $id ) {
		error_log( 'my-plugin: log cleared from the Code Blue window' );
	}
}, 10, 2 );
```
