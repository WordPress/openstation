/** Private, validated Preferences actions. No global command/ability registration. */
import type { MioAbility } from '../../../src/mio/assistant/types';
import type { OsSettingsState } from '../../../src/settings/types';
import { settings, update, applyThemeRecommendations, spendMenuRefresh } from './store';
import { type Ctx } from './types';
import {
	MIO_BOOLEAN_SETTINGS,
	mioSettingChoices,
	mioSettingsCatalog,
	mioNavItems,
	mioPinnableItems,
} from './mio-catalog';
import { saveForMio } from './mio-save';
import { extraMioActions } from './mio-extra-actions';

export const mioActionName = ( key: string ): string =>
	`set_${ key.replace( /[A-Z]/g, ( c ) => `_${ c.toLowerCase() }` ) }`;
export const objectSchema = ( properties: Record<string, unknown> ) => ( {
	type: 'object',
	properties,
	required: Object.keys( properties ),
	additionalProperties: false,
} );
export const exactKeys = ( args: Record<string, unknown>, keys: string[] ): boolean =>
	Object.keys( args ).length === keys.length &&
	keys.every( ( key ) => Object.prototype.hasOwnProperty.call( args, key ) );
const hex = ( value: unknown ): value is string =>
	typeof value === 'string' && /^#[0-9a-f]{6}$/i.test( value );

/** The schema and execution validation are generated from the same live choices. */
export function preferencesMioAbilities( ctx: Ctx ): MioAbility[] {
	const patch = async ( value: Partial<OsSettingsState>, signal: AbortSignal ) => {
		const result = await saveForMio( () => update( value ), signal, value );
		if ( 'developerModeEnabled' in value ) {
			spendMenuRefresh();
		}
		return result;
	};
	const choices = mioSettingChoices();
	const setters: MioAbility[] = Object.entries( choices ).map( ( [ key, values ] ) => ( {
		name: mioActionName( key ),
		description: `Set Preferences ${ key }. Current: ${ JSON.stringify( settings()[ key as keyof OsSettingsState ] ) }.${ key === 'desktopLayout' ? ' unified combines all docks; classic is Split.' : '' }${ key === 'desktopTheme' ? ' Read list_options first to choose from installed themes; this never changes the WordPress frontend theme.' : '' }`,
		parameters: objectSchema( {
			value: {
				type: typeof values[ 0 ] === 'number' ? 'number' : 'string',
				enum: [ ...new Set( values ) ],
			},
		} ),
		validate: ( args ) =>
			exactKeys( args, [ 'value' ] ) &&
			( mioSettingChoices()[ key ] ?? [] ).includes( args.value as string | number ),
		run: ( args, signal ) => patch( { [ key ]: args.value }, signal ),
	} ) );
	for ( const key of MIO_BOOLEAN_SETTINGS ) {
		setters.push( {
			name: mioActionName( key ),
			description: `Set Preferences ${ key }. Current: ${ settings()[ key ] }.`,
			parameters: objectSchema( { value: { type: 'boolean' } } ),
			validate: ( args ) => exactKeys( args, [ 'value' ] ) && typeof args.value === 'boolean',
			run: ( args, signal ) => patch( { [ key ]: args.value }, signal ),
		} );
	}
	const actions: MioAbility[] = [
		...setters,
		{
			name: 'list_options',
			effect: 'read',
			description:
				'List live themes (including surface colours), wallpapers, accents, effects, navigation and phone pin choices. Read before selecting ids.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: mioSettingsCatalog,
		},
		{
			name: 'read_settings',
			effect: 'read',
			description:
				'Read current preferences, active section and capability-gated site options.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: () => ( {
				settings: settings(),
				section: ctx.state.tab,
				extendedOptions: ctx.data.extendedOptions,
				commentsAi: ctx.data.commentsAi,
			} ),
		},
		{
			name: 'set_custom_accent',
			description: 'Set a custom six-digit hex accent and activate it.',
			parameters: objectSchema( { value: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } } ),
			validate: ( args ) => exactKeys( args, [ 'value' ] ) && hex( args.value ),
			run: ( args, signal ) =>
				patch( { accent: 'custom', customAccent: args.value as string }, signal ),
		},
		{
			name: 'set_custom_gradient',
			description:
				'Set both gradient colours and its angle, and activate the custom gradient wallpaper.',
			parameters: objectSchema( {
				from: { type: 'string' },
				to: { type: 'string' },
				angle: { type: 'number', minimum: 0, maximum: 360 },
			} ),
			validate: ( args ) =>
				exactKeys( args, [ 'from', 'to', 'angle' ] ) &&
				hex( args.from ) &&
				hex( args.to ) &&
				typeof args.angle === 'number' &&
				Number.isFinite( args.angle ) &&
				args.angle >= 0 &&
				args.angle <= 360,
			run: ( args, signal ) =>
				patch(
					{
						wallpaper: 'custom-gradient',
						customGradient: {
							from: args.from as string,
							to: args.to as string,
							angle: args.angle as number,
						},
					},
					signal,
				),
		},
		{
			name: 'set_window_reveal_duration',
			description:
				'Set reveal duration: 0 uses each effect’s default; otherwise 80–4000 milliseconds.',
			parameters: objectSchema( { value: { type: 'number' } } ),
			validate: ( args ) =>
				exactKeys( args, [ 'value' ] ) &&
				typeof args.value === 'number' &&
				( args.value === 0 ||
					( Number.isFinite( args.value ) && args.value >= 80 && args.value <= 4000 ) ),
			run: ( args, signal ) => patch( { windowRevealDuration: args.value as number }, signal ),
		},
		{
			name: 'set_navigation_placement',
			description:
				'Place one available Navigation item on the rail, desktop, both, or hidden. Preserves every other item.',
			parameters: objectSchema( {
				id: { type: 'string' },
				placement: { type: 'string', enum: [ 'rail', 'desktop', 'both', 'hidden' ] },
			} ),
			validate: ( args ) =>
				exactKeys( args, [ 'id', 'placement' ] ) &&
				mioNavItems().some( ( item ) => item.id === args.id ) &&
				[ 'rail', 'desktop', 'both', 'hidden' ].includes( args.placement as string ),
			run: ( args, signal ) =>
				patch(
					{
						navPlacement: {
							...settings().navPlacement,
							[ args.id as string ]: args.placement as 'rail',
						},
					},
					signal,
				),
		},
		{
			name: 'set_mobile_tabs',
			description:
				'Choose up to three available phone pins in order. Empty selects the server defaults; Home and Switcher are reserved.',
			parameters: objectSchema( {
				ids: { type: 'array', items: { type: 'string' }, maxItems: 3, uniqueItems: true },
			} ),
			validate: ( args ) =>
				exactKeys( args, [ 'ids' ] ) &&
				Array.isArray( args.ids ) &&
				args.ids.length <= 3 &&
				new Set( args.ids ).size === args.ids.length &&
				args.ids.every( ( id ) => mioPinnableItems().some( ( item ) => item.id === id ) ),
			run: ( args, signal ) => patch( { mobileTabs: args.ids as string[] }, signal ),
		},
		{
			name: 'apply_theme_recommendations',
			description:
				'Reapply the active theme’s recommended arrangement. Changes only the settings that theme recommends.',
			parameters: objectSchema( {} ),
			validate: ( args ) => exactKeys( args, [] ),
			run: async ( _args, signal ) => {
				if ( ! settings().desktopTheme ) {
					return { effect: 'none', status: 'completed', data: { changed: false, reason: 'System default has no recommended layout.' } };
				}
				return saveForMio( () => {
					if ( ! applyThemeRecommendations( settings().desktopTheme ) ) {
						throw new Error( 'This theme has no applicable recommendations.' );
					}
				}, signal );
			},
		},
		...extraMioActions( ctx, patch ),
	];
	return actions.map( ( action ) => ( { effect: 'write', ...action } ) );
}
