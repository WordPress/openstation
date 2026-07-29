import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import * as bc from '../../src/broadcast';
import { startRecycleBinBadge } from '../../src/recycle-bin/badge';

describe( 'Recycle Bin Badge Subscriptions', () => {
	beforeEach( () => {
		installHooksStub();
		vi.spyOn( bc, 'subscribe' );
	} );

	afterEach( () => {
		clearHooksStub();
		_resetAllSharedStoresForTests();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		const w = window as unknown as { desktopModeConfig?: unknown };
		delete w.desktopModeConfig;
	} );

	test( 'subscribes to dynamic CPT post types injected in desktopModeConfig', () => {
		const config = {
			recycleBinCount: 0,
			recycleBinCountUrl: 'http://localhost/count',
			recycleBinPostTypes: [ 'portfolio', 'product' ],
		};
		( window as any ).desktopModeConfig = config;

		startRecycleBinBadge( 0, 'http://localhost/count' );

		// Should subscribe to the CPTs
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.portfolio.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.product.changed', expect.any( Function ) );

		// Should subscribe to standard fixed extras
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.comment.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.placement.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.shortcut.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.folder.changed', expect.any( Function ) );

		// Should NOT subscribe to standard fallback post types like 'post' unless they were in the array
		expect( bc.subscribe ).not.toHaveBeenCalledWith( 'desktop-mode.post.changed', expect.any( Function ) );
	} );

	test( 'falls back to post, page, attachment when desktopModeConfig.recycleBinPostTypes is missing', () => {
		const config = {
			recycleBinCount: 0,
			recycleBinCountUrl: 'http://localhost/count',
		};
		( window as any ).desktopModeConfig = config;

		startRecycleBinBadge( 0, 'http://localhost/count' );

		// Should subscribe to the defaults
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.post.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.page.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.attachment.changed', expect.any( Function ) );

		// Should subscribe to standard fixed extras
		expect( bc.subscribe ).toHaveBeenCalledWith( 'desktop-mode.comment.changed', expect.any( Function ) );
	} );
} );
