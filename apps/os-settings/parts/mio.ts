/** Preferences is the worked example for a window-authored MIO context. */
import { __ } from '../../../src/i18n';
import type { MioDocument } from '../../../src/mio/assistant/types';
import { preferencesMioAbilities } from './mio-actions';
import { settings } from './store';
import { type Ctx } from './types';
import index from '../help/index.md?raw';
import appearance from '../help/appearance.md?raw';
import themes from '../help/themes.md?raw';
import windows from '../help/windows.md?raw';
import navigation from '../help/navigation.md?raw';
import features from '../help/features.md?raw';
import wallpaper from '../help/wallpaper.md?raw';
import reference from '../help/reference.md?raw';
import actions from '../help/actions.md?raw';

export const preferencesMioDocuments: MioDocument[] = Object.entries( {
	index,
	appearance,
	themes,
	windows,
	navigation,
	features,
	wallpaper,
	reference,
	actions,
} ).map( ( [ id, markdown ] ) => ( {
	id: `${ id }.md`,
	title: markdown.split( '\n' )[ 0 ].replace( /^# /, '' ),
	markdown,
} ) );

export function mountPreferencesMio( ctx: Ctx ): () => void {
	const lease = window.wp?.os?.mio?.registerWindow( ctx.windowId, {
		host: ctx.root,
		title: 'OpenStation Preferences',
		prompt: () =>
			`You are MIO, the warm, concise companion inside OpenStation Preferences. Help the user understand and customize this admin desktop. Your caller is this window; your scope is its non-destructive controls. Do not change the public website theme. Current section: ${ ctx.state.tab }. Current settings: ${ JSON.stringify( settings() ) }. Administrator: ${ ctx.data.isAdmin }. Use help for factual explanations, list_options for live choices, and only offered actions for changes. For "unify docks" choose desktopLayout unified. "Rounded corners" is windowRadius round. For "make both docks dynamic" in Split set both dockBehavior and sideDockBehavior. Apply a desktop theme before requested explicit overrides. Ask when an essential choice is unclear. Read results and report partial completion honestly. Current settings are refreshed AFTER each action; they are not the original state. Use the action result changed and changes (before/after) to describe what happened. Only say already selected when the action result explicitly reports changed:false. Never claim that opening an upload picker uploaded a file. Do not reset preferences, delete themes or purge sharing data.`,
		documents: preferencesMioDocuments,
		abilities: () => preferencesMioAbilities( ctx ),
	} );
	lease?.showCallout( {
		id: 'about-blog',
		target: () => ctx.state.tab === 'about'
			? ctx.root.querySelector<HTMLElement>( '.os-settings__about-journal-head' ) : null,
		message: __( 'Visit our blog!' ),
	} );
	return () => lease?.dispose();
}
