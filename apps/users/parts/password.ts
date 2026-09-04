/**
 * Users — the strong-password generator the Add User form and the
 * profile form share: WP core's `wp_generate_password` character set
 * with symbols enabled.
 */
export function generateStrongPassword( length: number ): string {
	const all = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*-_=+';
	const buf = new Uint32Array( length );
	crypto.getRandomValues( buf );
	let out = '';
	for ( let i = 0; i < length; i += 1 ) {
		out += all[ buf[ i ] % all.length ];
	}
	return out;
}
