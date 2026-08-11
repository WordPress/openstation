import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import * as bc from '../../src/broadcast';
import { startRecycleBinIconState } from '../../src/recycle-bin/icon-state';

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
		const w = window as unknown as { openStationConfig?: unknown };
		delete w.openStationConfig;
	} );

	test( 'subscribes to dynamic CPT post types injected in openStationConfig', () => {
		const config = {
			recycleBinCount: 0,
			recycleBinCountUrl: 'http://localhost/count',
			recycleBinPostTypes: [ 'portfolio', 'product' ],
		};
		( window as any ).openStationConfig = config;

		startRecycleBinIconState( 0, 'http://localhost/count' );

		// Should subscribe to the CPTs
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.portfolio.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.product.changed', expect.any( Function ) );

		// Should subscribe to standard fixed extras
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.comment.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.placement.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.shortcut.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.folder.changed', expect.any( Function ) );

		// Should NOT subscribe to standard fallback post types like 'post' unless they were in the array
		expect( bc.subscribe ).not.toHaveBeenCalledWith( 'os.post.changed', expect.any( Function ) );
	} );

	test( 'falls back to post, page, attachment when openStationConfig.recycleBinPostTypes is missing', () => {
		const config = {
			recycleBinCount: 0,
			recycleBinCountUrl: 'http://localhost/count',
		};
		( window as any ).openStationConfig = config;

		startRecycleBinIconState( 0, 'http://localhost/count' );

		// Should subscribe to the defaults
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.post.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.page.changed', expect.any( Function ) );
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.attachment.changed', expect.any( Function ) );

		// Should subscribe to standard fixed extras
		expect( bc.subscribe ).toHaveBeenCalledWith( 'os.comment.changed', expect.any( Function ) );
	} );
} );
