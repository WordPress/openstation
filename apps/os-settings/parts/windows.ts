import { __, html } from '@openstation/app';
import { OPEN_WINDOWS_AS, WINDOW_RADII } from '../../../src/settings/constants';
import {
	listUnfocusEffects,
	UNFOCUS_EFFECT_NONE as NONE,
} from '../../../src/effects/registry';
import {
	listWindowLinkRenderers,
	WINDOW_LINK_RENDERER_NONE as LINKS_NONE,
} from '../../../src/window-links/renderer-registry';
import {
	listWindowReveals,
	REVEAL_DURATION_AUTO,
	WINDOW_REVEAL_NONE as REVEAL_NONE,
} from '../../../src/reveals/registry';
import type { OpenWindowsAsId, WindowRadiusId } from '../../../src/settings/types';
import { translateWindowRadiusLabel } from './labels';
import { update } from './store';
import { pickedChecked, pickedValue, type Section } from './types';

export const windowRadiusSection: Section = ( s ) => html`
	<os-section heading=${ __( 'Window corners' ) } description=${ __( 'How rounded the corners of windows are.' ) }>
		<os-segmented
			value=${ s.windowRadius }
			label=${ __( 'Window corners' ) }
			@os-pick=${ ( e: Event ) => {
				const id = pickedValue( e );
				if ( WINDOW_RADII.some( ( r ) => r.id === id ) ) {
					update( { windowRadius: id as WindowRadiusId } );
				}
			} }
		>
			${ WINDOW_RADII.map(
				( r ) => html`<os-segment value=${ r.id }>${ translateWindowRadiusLabel( r.id, r.label ) }</os-segment>`,
			) }
		</os-segmented>
	</os-section>
`;

function openWindowsAsLabel( id: OpenWindowsAsId ): string {
	switch ( id ) {
		case 'maximized':
			return __( 'Maximized' );
		case 'focused':
			return __( 'Focused' );
		default:
			return __( 'Default' );
	}
}

export const openWindowsAsSection: Section = ( s ) => html`
	<os-section
		heading=${ __( 'Open windows as' ) }
		description=${ __( 'How a window lands when you open it. Focused fills the desk and minimizes the other windows, so there is one task in front of you at a time.' ) }
	>
		<os-segmented
			value=${ s.openWindowsAs }
			label=${ __( 'Open windows as' ) }
			@os-pick=${ ( e: Event ) => {
				const id = pickedValue( e );
				if ( OPEN_WINDOWS_AS.some( ( o ) => o.id === id ) ) {
					update( { openWindowsAs: id as OpenWindowsAsId } );
				}
			} }
		>
			${ OPEN_WINDOWS_AS.map(
				( o ) => html`<os-segment value=${ o.id }>${ openWindowsAsLabel( o.id ) }</os-segment>`,
			) }
		</os-segmented>
	</os-section>
`;

const REVEAL_SPEEDS = [
	{ value: REVEAL_DURATION_AUTO, label: () => __( 'Default (per reveal)' ) },
	{ value: 200, label: () => __( 'Very fast — 200 ms' ) },
	{ value: 320, label: () => __( 'Fast — 320 ms' ) },
	{ value: 460, label: () => __( 'Normal — 460 ms' ) },
	{ value: 700, label: () => __( 'Slow — 700 ms' ) },
	{ value: 1100, label: () => __( 'Very slow — 1100 ms' ) },
] as const;

const LINK_VISIBILITIES = [
	{ id: 'focus', label: () => __( 'When a related window is focused' ) },
	{ id: 'always', label: () => __( 'Always' ) },
	{ id: 'off', label: () => __( 'Off' ) },
] as const;

const registrySelect = (
	label: string,
	value: string,
	none: string,
	options: ReadonlyArray< { id: string; label: string } >,
	write: ( id: string ) => void,
) => html`<os-select
	value=${ value }
	label=${ label }
	@os-pick=${ ( e: Event ) => {
		const id = pickedValue( e );
		if ( id !== '' && ( id === none || options.some( ( o ) => o.id === id ) ) ) {
			write( id );
		}
	} }
>
	<os-option value=${ none }>${ __( 'None' ) }</os-option>
	${ options.map( ( o ) => html`<os-option value=${ o.id }>${ o.label }</os-option>` ) }
</os-select>`;

export const effectsSection: Section = ( s ) => {
	const effects = listUnfocusEffects();
	const reveals = listWindowReveals();
	const linkRenderers = listWindowLinkRenderers();
	const describe = < T extends { id: string; description?: string } >(
		list: T[],
		id: string,
		none: string,
		fallback: string,
	): string => {
		const active = list.find( ( item ) => item.id === id );
		return id !== none && active?.description ? active.description : fallback;
	};
	return html`
		<os-section
			heading=${ __( 'Unfocused windows' ) }
			description=${ describe(
				effects,
				s.unfocusEffect,
				NONE,
				__( 'Apply a visual treatment to every window except the one you are working in.' ),
			) }
		>
			${ registrySelect( __( 'Unfocused window effect' ), s.unfocusEffect, NONE, effects, ( id ) =>
				update( { unfocusEffect: id } ),
			) }
		</os-section>
		<os-section
			heading=${ __( 'Window reveal' ) }
			description=${ describe(
				reveals,
				s.windowReveal,
				REVEAL_NONE,
				__( 'Uncover a window’s content when it finishes loading, instead of fading it in.' ),
			) }
		>
			${ registrySelect( __( 'Reveal style' ), s.windowReveal, REVEAL_NONE, reveals, ( id ) =>
				update( { windowReveal: id } ),
			) }
			<os-select
				value=${ String( s.windowRevealDuration ) }
				label=${ __( 'Reveal speed' ) }
				@os-pick=${ ( e: Event ) => {
					const value = Number( pickedValue( e ) );
					if ( REVEAL_SPEEDS.some( ( speed ) => speed.value === value ) ) {
						update( { windowRevealDuration: value } );
					}
				} }
			>
				${ REVEAL_SPEEDS.map(
					( speed ) => html`<os-option value=${ String( speed.value ) }>${ speed.label() }</os-option>`,
				) }
			</os-select>
		</os-section>
		<os-section
			heading=${ __( 'Window links' ) }
			description=${ describe(
				linkRenderers,
				s.windowLinkRenderer,
				LINKS_NONE,
				__( 'Draw a visual tie between windows showing related content — a post and its comments or media.' ),
			) }
		>
			${ registrySelect( __( 'Link style' ), s.windowLinkRenderer, LINKS_NONE, linkRenderers, ( id ) =>
				update( { windowLinkRenderer: id } ),
			) }
			<os-select
				value=${ s.windowLinkVisibility }
				label=${ __( 'Show links' ) }
				@os-pick=${ ( e: Event ) => {
					const id = pickedValue( e );
					if ( id === 'focus' || id === 'always' || id === 'off' ) {
						update( { windowLinkVisibility: id } );
					}
				} }
			>
				${ LINK_VISIBILITIES.map( ( v ) => html`<os-option value=${ v.id }>${ v.label() }</os-option>` ) }
			</os-select>
		</os-section>
	`;
};

export const closeAllSection: Section = ( s ) => html`
	<os-section
		heading=${ __( 'Closing every window' ) }
		description=${ __(
			'⌥⌘W on macOS, Ctrl+Alt+W elsewhere, closes every open window on the desktop you are looking at. Unticked, it closes them without asking — a page holding unsaved changes still gets to raise its own prompt.',
		) }
	>
		<os-checkbox-label
			label=${ __( 'Ask before closing all windows' ) }
			?checked=${ s.confirmCloseAllWindows }
			@os-checkbox-change=${ ( e: Event ) => update( { confirmCloseAllWindows: pickedChecked( e ) } ) }
		></os-checkbox-label>
	</os-section>
`;

export const renderWindows: Section = ( s, ctx ) => html`
	${ openWindowsAsSection( s, ctx ) }
	${ windowRadiusSection( s, ctx ) }
	${ effectsSection( s, ctx ) }
	${ closeAllSection( s, ctx ) }
`;
