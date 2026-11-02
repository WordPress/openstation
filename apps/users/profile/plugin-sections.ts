/**
 * `<os-user-profile>`: the sections other plugins add to the profile.
 *
 * Plugins extend `profile.php` / `user-edit.php` by printing on
 * `show_user_profile` / `edit_user_profile` (and the Personal Options
 * hooks) and saving on the classic
 * POST, none of which the REST form runs. So when the facts say a
 * screen carries such sections, the real screen is embedded here
 * (`wp.os.embedAdminPage()`), narrowed server-side to those sections
 * (`apps/users/parts/plugin-sections.php`): the plugin's markup,
 * scripts, nonces and save hook run exactly as on the classic page.
 *
 * What the embed does not do on its own, done here: grow to the page's
 * height, open the page's off-site links, come back to the narrowed
 * screen when a round trip (a re-authentication through `wp-login.php`)
 * returns to the whole one, and save plugin edits made before the
 * element's own form saved (`plugin-sections-form.ts`). Links to other
 * admin screens are the embed's own business.
 */

import { __ } from '@openstation/app';
import { trackedFetch } from '../../../src/tracked-fetch';
import { isFormDirty, refreshUntouched, shouldRenarrow, snapshotForm, type FormSnapshot } from './plugin-sections-form';
import type { ProfileHost } from './types';

/** What the element holds on to: the teardown and the after-save step. */
export interface PluginSectionsHandle {
	teardown: () => void;
	/** The element's own form saved: reload the embed, or save its edits. */
	afterHostSave: () => void;
}

const NONE: PluginSectionsHandle = { teardown: () => {}, afterHostSave: () => {} };

/** The request flag the server narrows the screen on. */
const PROFILE_SECTIONS_FLAG = 'openstation_profile_sections';

type Embed = ( host: HTMLElement, url: string ) => () => void;

/** The narrowed screen for `userId`, or null when it has no plugin sections. */
function pluginSectionsUrl( userId: number, cfg: ProfileHost[ 'config' ] ): string | null {
	const sections = cfg.pluginSections;
	const own = userId === cfg.currentUserId;
	if ( ! sections?.adminUrl || ! ( own ? sections.own : sections.others ) ) {
		return null;
	}
	const url = new URL( own ? 'profile.php' : 'user-edit.php', sections.adminUrl );
	if ( ! own ) {
		url.searchParams.set( 'user_id', String( userId ) );
	}
	url.searchParams.set( PROFILE_SECTIONS_FLAG, '1' );
	// Set here, not only by the embed: the re-authentication's return
	// trip re-navigates to this URL itself.
	url.searchParams.set( 'openstation_chromeless', '1' );
	return url.toString();
}

/** Whether `url` is one of the two profile screens. */
function isProfileScreen( url: URL ): boolean {
	return /\/(profile|user-edit)\.php$/.test( url.pathname );
}

/**
 * Mount the plugin sections into `section` (its heading included).
 * Hides `section` when there is nothing to show.
 */
export function mountPluginSections( section: HTMLElement, userId: number, host: ProfileHost ): PluginSectionsHandle {
	const url = pluginSectionsUrl( userId, host.config );
	const embed = ( window as unknown as { wp?: { os?: { embedAdminPage?: Embed } } } ).wp?.os?.embedAdminPage;
	section.replaceChildren();
	if ( ! url || ! embed ) {
		section.hidden = true;
		return NONE;
	}
	section.hidden = false;

	const title = document.createElement( 'h3' );
	title.textContent = __( 'More settings' );
	title.style.cssText =
		'margin:18px 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--os-ui-fg-muted, #50575e);';
	const frameHost = document.createElement( 'div' );
	frameHost.style.cssText = 'display:flex;min-height:120px;';
	section.append( title, frameHost );

	const teardownEmbed = embed( frameHost, url );
	const iframe = frameHost.querySelector( 'iframe' );
	if ( ! iframe ) {
		section.hidden = true;
		return { teardown: teardownEmbed, afterHostSave: () => {} };
	}

	let resize: ResizeObserver | null = null;
	let renarrowed = false;
	let snapshot: FormSnapshot | null = null;
	const formOf = (): HTMLFormElement | null =>
		( iframe.contentDocument?.getElementById( 'your-profile' ) as HTMLFormElement | null ) ?? null;
	// Measured off the screen's own wrapper, never the document: the
	// chromeless document is at least as tall as its frame, so sizing
	// the frame to it only ever grows.
	const fit = (): void => {
		const wrap = iframe.contentDocument?.getElementById( 'profile-page' );
		if ( wrap ) {
			const rect = wrap.getBoundingClientRect();
			iframe.style.height = `${ Math.ceil( rect.bottom + ( iframe.contentWindow?.scrollY ?? 0 ) ) + 16 }px`;
		}
	};
	const onLoad = (): void => {
		resize?.disconnect();
		snapshot = null;
		let doc: Document | null = null;
		try {
			doc = iframe.contentDocument;
		} catch {
			return;
		}
		if ( ! doc?.body ) {
			return;
		}
		const here = new URL( doc.location.href );
		// Back on the whole screen (a re-authentication's return trip):
		// narrow it again, once, keeping the anchor the plugin asked for.
		// Anything that is not the profile form ("Invalid user ID.") stays.
		if ( shouldRenarrow( doc, isProfileScreen( here ), renarrowed ) ) {
			renarrowed = true;
			iframe.contentWindow?.location.replace( url + here.hash );
			return;
		}
		renarrowed = false;
		const form = formOf();
		snapshot = form ? snapshotForm( form ) : null;
		// A plugin can hook the profile and print nothing: no section then.
		section.hidden = ! Array.from( doc.querySelectorAll( '#your-profile > *' ) ).some(
			( el ) => ! el.matches( 'p.submit' ) && el.getClientRects().length > 0,
		);
		fit();
		if ( typeof ResizeObserver === 'function' ) {
			resize = new ResizeObserver( fit );
			const wrap = doc.getElementById( 'profile-page' );
			if ( wrap ) {
				resize.observe( wrap );
			}
		}
	};
	iframe.addEventListener( 'load', onLoad );

	// Off-site links: an embed has no sub-tab to open them in.
	const onMessage = ( e: MessageEvent ): void => {
		if ( e.source !== iframe.contentWindow || e.origin !== window.location.origin ) {
			return;
		}
		const data = e.data as { type?: string; url?: string } | null;
		if ( data?.type === 'os-external-link' && typeof data.url === 'string' ) {
			window.open( data.url, '_blank', 'noopener' );
		}
	};
	window.addEventListener( 'message', onMessage );

	const afterHostSave = (): void => {
		const form = formOf();
		// Untouched: reload, so it never posts the core values it loaded with.
		if ( ! form || ! snapshot || ! isFormDirty( form, snapshot ) ) {
			iframe.setAttribute( 'src', url );
			return;
		}
		// Edited: keep the edits, take the fresh values for the rest, save.
		const kept = snapshot;
		void trackedFetch( url, { credentials: 'same-origin' }, { source: 'user-profile' } )
			.then( ( res ) => ( res.ok ? res.text() : Promise.reject( new Error( String( res.status ) ) ) ) )
			.then( ( htmlText ) => {
				const fresh = new DOMParser().parseFromString( htmlText, 'text/html' ).getElementById( 'your-profile' );
				if ( ! fresh || formOf() !== form ) {
					throw new Error( 'stale' );
				}
				refreshUntouched( form, kept, fresh as HTMLFormElement );
				form.requestSubmit();
			} )
			.catch( () => {
				host.toast( __( 'Changes under More settings were not saved. Save them there.' ), 'error' );
			} );
	};

	return {
		teardown: () => {
			window.removeEventListener( 'message', onMessage );
			iframe.removeEventListener( 'load', onLoad );
			resize?.disconnect();
			teardownEmbed();
			section.replaceChildren();
		},
		afterHostSave,
	};
}
