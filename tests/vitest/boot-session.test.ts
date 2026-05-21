import { afterEach, describe, expect, test, vi } from 'vitest';
import { hasRestorableSession } from '../../src/boot/session';
import { wireSessionEvents } from '../../src/boot/shell-lifecycle';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
} from './helpers/hooks-stub';
import type { Session } from '../../src/types';

afterEach( () => {
	clearHooksStub();
} );

describe( 'boot session helpers', () => {
	test( 'treats desktop-only state as restorable once it has been saved', () => {
		expect(
			hasRestorableSession(
				session( {
					desktops: [
						{ id: 'desktop-1', label: 'Desktop 1' },
						{ id: 'desktop-2', label: 'Desktop 2' },
					],
					activeDesktop: 'desktop-2',
					updated: 10,
				} ),
			),
		).toBe( true );
	} );

	test( 'does not treat the server default empty shape as a saved session', () => {
		expect(
			hasRestorableSession(
				session( {
					updated: 0,
				} ),
			),
		).toBe( false );
	} );

	test( 'desktop lifecycle hooks schedule session persistence', () => {
		const hooks = installHooksStub();
		const save = vi.fn();
		wireSessionEvents( save );

		hooks.doAction( HOOKS.DESKTOP_CREATED, { desktopId: 'desktop-2' } );
		hooks.doAction( HOOKS.DESKTOP_SWITCHED, {
			from: 'desktop-1',
			to: 'desktop-2',
		} );
		hooks.doAction( HOOKS.DESKTOP_CLOSED, {
			desktopId: 'desktop-2',
			migratedTo: 'desktop-1',
		} );

		expect( save ).toHaveBeenCalledTimes( 3 );
	} );
} );

function session( patch: Partial< Session > = {} ): Session {
	return {
		windows: [],
		desktops: [ { id: 'desktop-1', label: 'Desktop 1' } ],
		activeDesktop: 'desktop-1',
		focused: '',
		updated: 0,
		...patch,
	};
}
