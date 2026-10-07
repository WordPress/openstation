import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { handleWindowMessage } from '../../src/window/iframe-bridge';

function buildFakeWindow() {
	const setAppearanceTheme = vi.fn();
	const setAppearanceControls = vi.fn();
	const setAppearanceSlot = vi.fn();
	const fakeContentWindow = {} as Window;
	return {
		win: {
			id: 'edit-post',
			iframe: { contentWindow: fakeContentWindow } as unknown as HTMLIFrameElement,
			setAppearanceTheme,
			setAppearanceControls,
			setAppearanceSlot,

			setTitle: vi.fn(),
		},
		fakeContentWindow,
		spies: { setAppearanceTheme, setAppearanceControls, setAppearanceSlot },
	};
}

function postFrom( source: Window, data: unknown ): MessageEvent {
	return new MessageEvent( 'message', {
		origin: window.location.origin,
		source,
		data,
	} );
}

beforeEach( () => {
	installHooksStub();
} );

afterEach( () => {
	clearHooksStub();
} );

describe( 'iframe-bridge — chrome messages', () => {
	test( 'os-chrome-theme dispatches setAppearanceTheme(tokens)', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'os-chrome-theme',
			tokens: {
				'--os-titlebar-bg': '#101820',
			},
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).toHaveBeenCalledWith( {
			'--os-titlebar-bg': '#101820',
		} );
	} );

	test( 'os-chrome-controls dispatches setAppearanceControls(config)', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'os-chrome-controls',
			config: { hide: [ 'core/detach' ] },
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceControls ).toHaveBeenCalledWith( {
			hide: [ 'core/detach' ],
		} );
	} );

	test( 'os-chrome-slot dispatches setAppearanceSlot(name, { html })', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'os-chrome-slot',
			slot: 'after-title',
			html: 'BETA',
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceSlot ).toHaveBeenCalledWith(
			'after-title',
			{ html: 'BETA' },
		);
	} );

	test( 'foreign origin is ignored', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = new MessageEvent( 'message', {
			origin: 'https://attacker.test',
			source: fakeContentWindow,
			data: {
				type: 'os-chrome-theme',
				tokens: { '--bad': '1' },
			},
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );

	test( 'message from a different iframe (wrong source) is ignored', () => {
		const { win, spies } = buildFakeWindow();
		const otherSource = {} as Window;
		const ev = postFrom( otherSource, {
			type: 'os-chrome-theme',
			tokens: { '--x': '1' },
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );

	test( 'malformed payload (missing tokens) is rejected', () => {
		const { win, fakeContentWindow, spies } = buildFakeWindow();
		const ev = postFrom( fakeContentWindow, {
			type: 'os-chrome-theme',
		} );
		handleWindowMessage(
			win as Parameters< typeof handleWindowMessage >[ 0 ],
			ev,
		);
		expect( spies.setAppearanceTheme ).not.toHaveBeenCalled();
	} );
} );
