/**
 * The row above overview's desktop tiles — the seam the shell uses for
 * the site switcher on a network. Overview builds it from an installed
 * builder and nothing else, so a shell that installs none (every
 * single-site shell) gets the bar it always had.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { installOverviewHeader } from '../../src/window-manager/overview';
import {
	OVERVIEW_TOP_BAR_HEADER_RESERVE,
	OVERVIEW_TOP_BAR_RESERVE,
	overviewTopBarReserve,
} from '../../src/window-manager/overview-constants';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'the overview header row', () => {
	let desktopArea: HTMLElement;
	let manager: WindowManager;
	let teardown: ( () => void ) | null = null;

	beforeEach( () => {
		installHooksStub();
		desktopArea = document.createElement( 'div' );
		Object.defineProperty( desktopArea, 'getBoundingClientRect', {
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
		Object.defineProperty( desktopArea, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktopArea, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktopArea );
		manager = new WindowManager( desktopArea );
	} );

	afterEach( () => {
		teardown?.();
		teardown = null;
		manager.exitOverview();
		desktopArea.remove();
		clearHooksStub();
	} );

	test( 'sits above the tiles when a shell installs it, and only then', () => {
		manager.enterOverview();
		let bar = desktopArea.querySelector( '.os-overview-top-bar' );
		expect( bar?.querySelector( '.os-overview-top-bar__header' ) ).toBeNull();
		expect( overviewTopBarReserve( bar as HTMLElement ) ).toBe( OVERVIEW_TOP_BAR_RESERVE );
		manager.exitOverview();

		const switcher = document.createElement( 'div' );
		switcher.className = 'fake-switcher';
		teardown = installOverviewHeader( () => switcher );

		manager.enterOverview();
		bar = desktopArea.querySelector( '.os-overview-top-bar' );
		const header = bar?.querySelector( '.os-overview-top-bar__header' );
		expect( header?.firstElementChild ).toBe( switcher );
		// Above the tiles, not among them.
		expect( bar?.firstElementChild ).toBe( header );
		expect( bar?.querySelector( '.os-overview-top-bar__list' ) ).not.toBeNull();
		expect( overviewTopBarReserve( bar as HTMLElement ) ).toBe(
			OVERVIEW_TOP_BAR_RESERVE + OVERVIEW_TOP_BAR_HEADER_RESERVE,
		);
	} );

	test( 'a builder answering null leaves the bar as it was', () => {
		teardown = installOverviewHeader( () => null );
		manager.enterOverview();
		const bar = desktopArea.querySelector( '.os-overview-top-bar' );
		expect( bar?.querySelector( '.os-overview-top-bar__header' ) ).toBeNull();
		expect( bar?.firstElementChild?.className ).toBe( 'os-overview-top-bar__list' );
	} );
} );
