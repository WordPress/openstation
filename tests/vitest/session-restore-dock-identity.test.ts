/**
 * Session restore must recover a window's dock identity — and with it
 * the submenu tab strip — even when the saved URL matches no menu
 * entry.
 *
 * The MailPoet shape: until its welcome wizard is done, every
 * MailPoet page redirects to `?page=mailpoet-landingpage`, a slug no
 * dock item or submenu lists. The session saves the window's CURRENT
 * URL (the landing page), so resolving the owning dock entry from the
 * URL alone comes up empty and the window used to restore with no tab
 * strip at all. The saved `baseId` still carries the open-time
 * identity, and the restore path now falls back to it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { restoreSession } from '../../src/boot/session';
import {
	findDockEntryForUrl,
	findDockEntryForWindowId,
} from '../../src/boot/geometry';
import { WindowManager } from '../../src/window-manager';
import { deriveWindowId } from '../../src/utils';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type {
	DesktopConfig,
	DockItemConfig,
	Session,
	SessionWindow,
} from '../../src/types';

const ORIGIN = window.location.origin;
const ADMIN_URL = `${ ORIGIN }/wp-admin/`;
const MP_HOME = `${ ADMIN_URL }admin.php?page=mailpoet-homepage`;
const MP_EMAILS = `${ ADMIN_URL }admin.php?page=mailpoet-newsletters`;
const MP_LANDING = `${ ADMIN_URL }admin.php?page=mailpoet-landingpage&openstation_chromeless=1`;
const PAGES_URL = `${ ADMIN_URL }edit.php?post_type=page`;

const MAILPOET_DOCK: DockItemConfig = {
	id: 'mailpoet-homepage',
	title: 'MailPoet',
	icon: 'dashicons-email',
	url: MP_HOME,
	badge: 0,
	submenu: [
		{ title: 'Home', url: MP_HOME },
		{ title: 'Emails', url: MP_EMAILS },
	],
};

const PAGES_DOCK: DockItemConfig = {
	id: 'edit-php-post-type-page',
	title: 'Pages',
	icon: 'dashicons-admin-page',
	url: PAGES_URL,
	badge: 0,
	submenu: [ { title: 'All Pages', url: PAGES_URL } ],
};

function desktopConfig( windows: SessionWindow[] ): DesktopConfig {
	const session: Session = {
		windows,
		desktops: [ { id: 'desktop-1', label: 'Desktop 1' } ],
		activeDesktop: 'desktop-1',
		focused: '',
		updated: 123,
	};
	return {
		adminUrl: ADMIN_URL,
		currentPage: MP_HOME,
		currentTitle: 'MailPoet',
		currentIcon: 'dashicons-email',
		dockItems: [ MAILPOET_DOCK, PAGES_DOCK ],
		session,
	} as unknown as DesktopConfig;
}

function mailpoetWindow( patch: Partial< SessionWindow > = {} ): SessionWindow {
	const baseId = deriveWindowId( MP_HOME, ADMIN_URL );
	return {
		id: baseId,
		baseId,
		desktopId: 'desktop-1',
		url: MP_LANDING,
		title: 'MailPoet',
		icon: 'dashicons-email',
		state: 'normal',
		x: 100,
		y: 80,
		width: 900,
		height: 600,
		...patch,
	};
}

describe( 'findDockEntryForWindowId', () => {
	test( 'matches a dock item by its derived window id', () => {
		const config = desktopConfig( [] );
		const id = deriveWindowId( MP_HOME, ADMIN_URL );
		expect( findDockEntryForWindowId( id, config ) ).toBe( MAILPOET_DOCK );
	} );

	test( 'matches through a submenu child id', () => {
		const config = desktopConfig( [] );
		const id = deriveWindowId( MP_EMAILS, ADMIN_URL );
		expect( findDockEntryForWindowId( id, config ) ).toBe( MAILPOET_DOCK );
	} );

	test( 'returns undefined for an off-menu id and an empty id', () => {
		const config = desktopConfig( [] );
		const id = deriveWindowId( MP_LANDING, ADMIN_URL );
		expect( findDockEntryForWindowId( id, config ) ).toBeUndefined();
		expect( findDockEntryForWindowId( '', config ) ).toBeUndefined();
	} );
} );

describe( 'restoreSession — dock identity fallback', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'os-area';
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		clearHooksStub();
	} );

	test( 'a window parked on an off-menu URL keeps its submenu', async () => {
		const win = mailpoetWindow();
		// Sanity: the URL alone resolves nothing — this scenario is
		// exactly the one the baseId fallback exists for.
		const config = desktopConfig( [ win ] );
		expect( findDockEntryForUrl( win.url, config ) ).toBeUndefined();

		await restoreSession( manager, config, desktop );

		const restored = manager.getById( win.id );
		expect( restored ).toBeTruthy();
		expect( restored?.config.submenu ).toEqual( MAILPOET_DOCK.submenu );
		expect(
			restored?.element.querySelectorAll(
				'.os-window__tab[data-kind="submenu"]',
			).length,
		).toBeGreaterThan( 0 );
	} );

	test( 'a URL that matches another dock entry wins over baseId', async () => {
		// The window was opened as MailPoet but navigated onto the
		// Pages screen before the reload — it belongs to Pages now.
		const win = mailpoetWindow( { url: PAGES_URL } );
		const config = desktopConfig( [ win ] );

		await restoreSession( manager, config, desktop );

		const restored = manager.getById( win.id );
		expect( restored?.config.submenu ).toEqual( PAGES_DOCK.submenu );
	} );
} );
