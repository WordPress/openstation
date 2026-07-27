/**
 * OS-file drop manager — shared byte-size formatter.
 *
 * Renders a number of bytes as a short human-readable string:
 * `0 B` / `844 B` / `12 KB` / `1.4 MB` / `2.0 GB`. Used by the
 * upload dialog (file-size column) and the floating HUD
 * (per-tick `loaded / total`).
 *
 * Decimals:
 *   - bytes → no decimal (`844 B`).
 *   - everything else → one decimal unless the rounded value
 *     would render `≥ 100` (in which case the decimal is dropped
 *     so labels don't get noisier as the unit gets bigger:
 *     `12.4 MB` but `123 MB`).
 *
 * The previous two ad-hoc implementations (dialog + HUD) used
 * subtly different rounding rules — keep this one as the single
 * source of truth.
 */
export function formatBytes( bytes: number ): string {
	if ( ! Number.isFinite( bytes ) || bytes <= 0 ) {
		return '0 B';
	}
	const units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	let v = bytes;
	let i = 0;
	while ( v >= 1024 && i < units.length - 1 ) {
		v /= 1024;
		i++;
	}
	const decimals = v >= 100 || i === 0 ? 0 : 1;
	return `${ v.toFixed( decimals ) } ${ units[ i ] }`;
}
