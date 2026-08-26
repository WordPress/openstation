import { describe, expect, test } from 'vitest';
import {
	renderCardPreferences,
	renderCards,
	type StationHomeCard,
	type StationHomeCardPreference,
} from './index';

const card = ( overrides: Partial< StationHomeCard > = {} ): StationHomeCard => ( {
	id: 'backup-health',
	label: 'Backup health',
	description: 'Your latest backup is ready.',
	provider: 'Example Backup',
	icon: 'dashicons-backup',
	value: 'Healthy',
	detail: 'Last backup: 12 minutes ago',
	url: 'https://example.test/wp-admin/admin.php?page=backup',
	actionLabel: 'View backups',
	external: false,
	tone: 'success',
	...overrides,
} );

const preference = (
	overrides: Partial< StationHomeCardPreference > = {},
): StationHomeCardPreference => ( {
	id: 'backup-health',
	label: 'Backup health',
	description: 'Show backup status on Station Home.',
	provider: 'Example Backup',
	icon: 'dashicons-backup',
	enabled: true,
	defaultEnabled: false,
	...overrides,
} );

describe( 'Station Home plugin cards', () => {
	test( 'renders structured card content without accepting markup', () => {
		const host = document.createElement( 'div' );

		renderCards( host, [ card( { label: '<em>Backup health</em>' } ) ] );

		const surface = host.querySelector< HTMLAnchorElement >( 'a' );
		expect( surface?.href ).toBe(
			'https://example.test/wp-admin/admin.php?page=backup',
		);
		expect( surface?.dataset.tone ).toBe( 'success' );
		expect( surface?.querySelector( 'em' ) ).toBeNull();
		expect( surface?.textContent ).toContain( '<em>Backup health</em>' );
		expect( surface?.textContent ).toContain( 'View backups' );
		expect( surface?.querySelector( '.dashicons-backup' ) ).not.toBeNull();
	} );

	test( 'decodes entities in card text without parsing markup', () => {
		// WordPress texturizes on the way out, so a curly apostrophe
		// arrives as `&#8217;` and printing it into `textContent` shows
		// the entity itself. Decoding is not the same as accepting
		// HTML: `decodeHTML` reads through a `<textarea>`, whose
		// content is escapable raw text, so a tag stays a literal
		// string and lands in `textContent` unparsed. The two
		// assertions below are the pair that has to hold together.
		const host = document.createElement( 'div' );

		renderCards( host, [
			card( {
				label: 'Don&#8217;t panic',
				provider: 'Caf&eacute; &amp; Co',
				value: '&lt;script&gt;',
				detail: 'It&#8217;s fine',
			} ),
		] );

		expect( host.textContent ).toContain( 'Don’t panic' );
		expect( host.textContent ).toContain( 'Café & Co' );
		expect( host.textContent ).toContain( 'It’s fine' );
		expect( host.textContent ).toContain( '<script>' );
		expect( host.querySelector( 'script' ) ).toBeNull();
		expect( host.textContent ).not.toContain( '&#8217;' );
	} );

	test( 'renders a useful opt-in prompt when no cards are enabled', () => {
		const host = document.createElement( 'div' );

		renderCards( host, [] );

		expect( host.textContent ).toContain( 'Make this space yours' );
		expect( host.textContent ).toContain( 'Use Customize to opt in' );
	} );

	test( 'reflects each saved preference in an accessible switch', () => {
		const host = document.createElement( 'div' );

		renderCardPreferences( host, [ preference() ] );

		const control = host.querySelector( 'os-switch' );
		expect( control?.getAttribute( 'value' ) ).toBe( 'backup-health' );
		expect( control?.getAttribute( 'label' ) ).toBe( 'Backup health' );
		expect( control?.getAttribute( 'description' ) ).toBe(
			'Example Backup — Show backup status on Station Home.',
		);
		expect( control?.hasAttribute( 'checked' ) ).toBe( true );
	} );
} );
