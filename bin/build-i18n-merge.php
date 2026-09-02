<?php
/**
 * Merge per-source-file Jed JSONs produced by `wp i18n make-json` into
 * a single per-handle JSON for one locale. Driven by env vars set by
 * bin/build-i18n.sh; not intended to run on its own.
 *
 * Inputs (env):
 *   HANDLE_MAP_PREFIX   Source path prefix that selects which hashed
 *                       JSONs feed this handle, e.g. "apps/trash/".
 *                       Files whose `source` starts with the prefix of an
 *                       earlier (more specific) handle are skipped here,
 *                       so the most specific handle should run first.
 *   HANDLE_OUT_FILE     Final output file path for this handle.
 *   HANDLE_SOURCES_DIR  Directory containing the hashed JSONs from
 *                       `wp i18n make-json`.
 *   HANDLE_LOCALE       Locale slug (e.g. es_ES). Used in the output
 *                       header and revision-date passthrough.
 *   HANDLE_DOMAIN       Text domain (e.g. openstation).
 *
 * Output: writes HANDLE_OUT_FILE if at least one translation matches the
 * prefix, removes a stale file otherwise.
 */

$prefix      = getenv( 'HANDLE_MAP_PREFIX' );
$out_file    = getenv( 'HANDLE_OUT_FILE' );
$sources_dir = getenv( 'HANDLE_SOURCES_DIR' );
$locale      = getenv( 'HANDLE_LOCALE' );
$domain      = getenv( 'HANDLE_DOMAIN' );

if ( ! $prefix || ! $out_file || ! $sources_dir || ! $locale || ! $domain ) {
	fwrite( STDERR, "build-i18n-merge.php: missing required env vars.\n" );
	exit( 1 );
}

// Determine which prefixes are MORE specific than ours, so we can
// exclude their sources from this handle's bundle. We re-derive the
// list from the script's own ordering hint: anything passed via the
// EXCLUDE_PREFIXES env var (newline separated) is skipped.
$exclude = array_filter( preg_split( '/\R/', (string) getenv( 'HANDLE_EXCLUDE_PREFIXES' ) ) );

$plurals       = '';
$revision_date = '';
$messages      = array();

$files = glob( rtrim( $sources_dir, '/' ) . '/*.json' );
if ( ! $files ) {
	$files = array();
}

foreach ( $files as $file ) {
	$raw = file_get_contents( $file );
	if ( false === $raw ) {
		continue;
	}
	$data = json_decode( $raw, true );
	if ( ! is_array( $data ) ) {
		continue;
	}
	$source = isset( $data['source'] ) ? (string) $data['source'] : '';
	if ( '' === $source || 0 !== strpos( $source, $prefix ) ) {
		continue;
	}
	foreach ( $exclude as $skip ) {
		if ( '' !== $skip && 0 === strpos( $source, $skip ) ) {
			continue 2;
		}
	}

	if ( '' === $revision_date && ! empty( $data['translation-revision-date'] ) ) {
		$revision_date = (string) $data['translation-revision-date'];
	}

	if (
		! empty( $data['locale_data']['messages'][''] ) &&
		is_array( $data['locale_data']['messages'][''] )
	) {
		$header = $data['locale_data']['messages'][''];
		if ( ! empty( $header['plural-forms'] ) && '' === $plurals ) {
			$plurals = (string) $header['plural-forms'];
		}
	}

	if ( ! empty( $data['locale_data']['messages'] ) && is_array( $data['locale_data']['messages'] ) ) {
		foreach ( $data['locale_data']['messages'] as $key => $value ) {
			if ( '' === $key ) {
				continue;
			}
			$messages[ $key ] = $value;
		}
	}
}

if ( empty( $messages ) ) {
	if ( file_exists( $out_file ) ) {
		unlink( $out_file );
	}
	exit( 0 );
}

ksort( $messages );

$header = array(
	'domain'       => 'messages',
	'lang'         => $locale,
	'plural-forms' => '' !== $plurals ? $plurals : 'nplurals=2; plural=(n != 1);',
);

$json = array(
	'translation-revision-date' => '' !== $revision_date ? $revision_date : gmdate( 'Y-m-d H:iO' ),
	'generator'                 => 'desktop-mode/build-i18n.sh',
	'domain'                    => 'messages',
	'locale_data'               => array(
		'messages' => array_merge( array( '' => $header ), $messages ),
	),
);

$encoded = json_encode( $json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
if ( false === $encoded ) {
	fwrite( STDERR, "build-i18n-merge.php: failed to encode JSON for {$out_file}.\n" );
	exit( 1 );
}

if ( false === file_put_contents( $out_file, $encoded . "\n" ) ) {
	fwrite( STDERR, "build-i18n-merge.php: failed to write {$out_file}.\n" );
	exit( 1 );
}
