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
