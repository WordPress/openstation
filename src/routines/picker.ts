/**
 * Routines — trigger + step picker dialogs.
 *
 * The trigger picker is tabbed: Common, By plugin, Search hooks,
 * Broadcast topics. Each tab is a filter on the catalog's
 * `triggers` array — a single declaration site (the catalog REST
 * endpoint) gives every tab a consistent shape.
 *
 * The step picker is grouped by kind: Built-in (email/log/wait/if),
 * Action (registered routine actions), AI tool, Command (slash
 * commands once Phase 3 wires them up).
 *
 * @since 0.22.0
 */

import { el, openModal, groupBy } from './dom';
import type {
	Catalog,
	CatalogAction,
	CatalogAiTool,
	CatalogTrigger,
	StepKind,
} from './types';

export interface PickedTrigger {
	kind: 'hook' | 'broadcast';
	id: string;
	priority: number;
	declared?: CatalogTrigger;
}

export interface PickedStep {
	kind: StepKind;
	id: string;
	label: string;
}

/**
 * Open the trigger picker. Resolves the user's selection or null
 * on cancel.
 *
 * @param body    Window body to mount the dialog into.
 * @param catalog Resolved catalog (triggers + actions + ai_tools).
 */
export function pickTrigger(
	body: HTMLElement,
	catalog: Catalog,
): Promise< PickedTrigger | null > {
	return new Promise( ( resolve ) => {
		const { card, close } = openModal( body, 'Pick a trigger' );
		card.classList.add( 'wpdm-routines__modal-card--wide' );

		const tabs = el( 'div', { class: 'wpdm-routines__tabs' } );
		const panel = el( 'div', { class: 'wpdm-routines__tab-panel' } );

		type TabId = 'common' | 'by-plugin' | 'hook' | 'broadcast';
		let activeTab: TabId = 'common';

		const tabDefs: Array< { id: TabId; label: string } > = [
			{ id: 'common', label: 'Common' },
			{ id: 'by-plugin', label: 'By plugin' },
			{ id: 'hook', label: 'Hook search' },
			{ id: 'broadcast', label: 'Broadcast' },
		];

		const renderTab = (): void => {
			panel.replaceChildren();
			if ( activeTab === 'common' ) {
				renderCommon( panel, catalog.triggers, ( t ) => {
					close();
					resolve( {
						kind: t.kind,
						id: t.id,
						priority: t.priority,
						declared: t,
					} );
				} );
			} else if ( activeTab === 'by-plugin' ) {
				renderByPlugin( panel, catalog.triggers, ( t ) => {
					close();
					resolve( {
						kind: t.kind,
						id: t.id,
						priority: t.priority,
						declared: t,
					} );
				} );
			} else if ( activeTab === 'hook' ) {
				renderHookSearch( panel, ( t ) => {
					close();
					resolve( t );
				} );
			} else {
				renderBroadcast( panel, ( t ) => {
					close();
					resolve( t );
				} );
			}
		};

		for ( const def of tabDefs ) {
			const btn = el( 'button', {
				class:
					'wpdm-routines__tab' +
					( def.id === activeTab ? ' is-active' : '' ),
				type: 'button',
			} );
			btn.textContent = def.label;
			btn.addEventListener( 'click', () => {
				activeTab = def.id;
				for ( const child of tabs.children ) {
					child.classList.toggle(
						'is-active',
						child === btn,
					);
				}
				renderTab();
			} );
			tabs.append( btn );
		}

		card.append( tabs, panel );
		renderTab();

		const cancel = el(
			'button',
			{ class: 'wpdm-routines__btn', type: 'button' },
			[ 'Cancel' ],
		);
		cancel.addEventListener( 'click', () => {
			close();
			resolve( null );
		} );
		card.append( cancel );
	} );
}

function renderCommon(
	host: HTMLElement,
	triggers: CatalogTrigger[],
	onPick: ( t: CatalogTrigger ) => void,
): void {
	const hooks = triggers.filter( ( t ) => t.kind === 'hook' );
	if ( hooks.length === 0 ) {
		host.append(
			el( 'p', { class: 'wpdm-routines__empty-text' }, [
				'No declared triggers yet — try Hook search to use any WordPress action by name.',
			] ),
		);
		return;
	}
	const groups = groupBy( hooks, 'group' );
	for ( const [ group, list ] of groups ) {
		const section = el( 'section', { class: 'wpdm-routines__picker-group' } );
		const heading = el( 'h4', {} );
		heading.textContent = group || 'Other';
		section.append( heading );
		for ( const t of list ) {
			section.append( triggerCard( t, onPick ) );
		}
		host.append( section );
	}
}

function renderByPlugin(
	host: HTMLElement,
	triggers: CatalogTrigger[],
	onPick: ( t: CatalogTrigger ) => void,
): void {
	// "By plugin" is currently the same data as "Common" — both
	// look at `group`. Once plugin authors register triggers, the
	// "Common" tab keeps the WP-core defaults and "By plugin" only
	// shows entries from a non-core group. Today we just split on
	// whether the group looks like a plugin name (case-sensitive
	// presence of a non-empty group that isn't a built-in section).
	const builtIn = new Set( [ 'Content', 'Comments', 'Users', 'Site' ] );
	const pluginTriggers = triggers.filter(
		( t ) => t.group && ! builtIn.has( t.group ),
	);
	if ( pluginTriggers.length === 0 ) {
		host.append(
			el( 'p', { class: 'wpdm-routines__empty-text' }, [
				'No plugin-declared triggers found. Plugin authors register them with `desktop_mode_register_routine_trigger()`.',
			] ),
		);
		return;
	}
	renderCommon( host, pluginTriggers, onPick );
}

function renderHookSearch(
	host: HTMLElement,
	onPick: ( t: PickedTrigger ) => void,
): void {
	host.append(
		el( 'p', { class: 'wpdm-routines__hint' }, [
			'Type any WordPress action name (e.g. `save_post`, `wp_login`). The routine will fire whenever that action runs.',
		] ),
	);
	const input = el( 'input', {
		class: 'wpdm-routines__hook-input',
		type: 'text',
		placeholder: 'hook_name',
	} ) as HTMLInputElement;
	const priority = el( 'input', {
		class: 'wpdm-routines__hook-priority',
		type: 'number',
		value: '10',
	} ) as HTMLInputElement;
	const useBtn = el(
		'button',
		{ class: 'wpdm-routines__btn wpdm-routines__btn--primary', type: 'button' },
		[ 'Use this hook' ],
	);
	useBtn.addEventListener( 'click', () => {
		const id = input.value.trim();
		if ( ! id ) {
			input.focus();
			return;
		}
		onPick( {
			kind: 'hook',
			id,
			priority: parseInt( priority.value, 10 ) || 10,
		} );
	} );
	const row = el( 'div', { class: 'wpdm-routines__hook-row' } );
	row.append(
		el( 'label', {}, [ 'Hook', input ] ),
		el( 'label', {}, [ 'Priority', priority ] ),
		useBtn,
	);
	host.append( row );
}

function renderBroadcast(
	host: HTMLElement,
	onPick: ( t: PickedTrigger ) => void,
): void {
	host.append(
		el( 'p', { class: 'wpdm-routines__hint' }, [
			'Listen for a Desktop Mode broadcast topic — `wp-desktop.<domain>.changed`, `<plugin>/<event>`, etc. Topics fire across windows in real time.',
		] ),
	);
	const input = el( 'input', {
		class: 'wpdm-routines__hook-input',
		type: 'text',
		placeholder: 'wp-desktop.post.changed',
	} ) as HTMLInputElement;
	const useBtn = el(
		'button',
		{ class: 'wpdm-routines__btn wpdm-routines__btn--primary', type: 'button' },
		[ 'Use this topic' ],
	);
	useBtn.addEventListener( 'click', () => {
		const id = input.value.trim();
		if ( ! id ) {
			input.focus();
			return;
		}
		onPick( { kind: 'broadcast', id, priority: 10 } );
	} );
	const row = el( 'div', { class: 'wpdm-routines__hook-row' } );
	row.append( el( 'label', {}, [ 'Topic', input ] ), useBtn );
	host.append( row );
}

function triggerCard(
	t: CatalogTrigger,
	onPick: ( picked: CatalogTrigger ) => void,
): HTMLElement {
	const card = el( 'button', {
		class: 'wpdm-routines__picker-card',
		type: 'button',
	} );
	const icon = el( 'span', {
		class: `dashicons ${ t.icon || 'dashicons-flag' }`,
	} );
	icon.setAttribute( 'aria-hidden', 'true' );
	const main = el( 'span', { class: 'wpdm-routines__picker-card-main' } );
	const title = el( 'span', { class: 'wpdm-routines__picker-card-title' } );
	title.textContent = t.label;
	const meta = el( 'span', { class: 'wpdm-routines__picker-card-meta' } );
	meta.textContent = `${ t.id } • ${
		Object.keys( t.payload_schema || {} ).length
	} fields`;
	main.append( title, meta );
	card.append( icon, main );
	card.addEventListener( 'click', () => onPick( t ) );
	return card;
}

// ---- Step picker -----------------------------------------------------

/**
 * Open the step picker. Returns the user's selection or null.
 */
export function pickStep(
	body: HTMLElement,
	catalog: Catalog,
): Promise< PickedStep | null > {
	return new Promise( ( resolve ) => {
		const { card, close } = openModal( body, 'Add a step' );
		card.classList.add( 'wpdm-routines__modal-card--wide' );

		const builtIn: PickedStep[] = [
			{ kind: 'log', id: '', label: 'Log a message' },
			{ kind: 'email', id: '', label: 'Send email' },
			{ kind: 'http', id: '', label: 'HTTP request' },
			{ kind: 'wait', id: '', label: 'Wait' },
			{ kind: 'set_var', id: '', label: 'Set a variable' },
			{ kind: 'if', id: '', label: 'If / then / else' },
			{ kind: 'classify', id: '', label: 'Classify with AI' },
			{ kind: 'stop', id: '', label: 'Stop the routine' },
		];

		const sections: Array< { title: string; steps: PickedStep[] } > = [
			{ title: 'Built-in steps', steps: builtIn },
			{
				title: 'Plugin actions',
				steps: catalog.actions.map( ( a: CatalogAction ) => ( {
					kind: 'action' as StepKind,
					id: a.id,
					label: a.label,
				} ) ),
			},
			{
				title: 'AI tools',
				steps: catalog.ai_tools.map( ( t: CatalogAiTool ) => ( {
					kind: 'ai_tool' as StepKind,
					id: t.name,
					label: t.description || t.name,
				} ) ),
			},
		];

		for ( const section of sections ) {
			if ( section.steps.length === 0 ) {
				continue;
			}
			const wrap = el( 'section', {
				class: 'wpdm-routines__picker-group',
			} );
			const h = el( 'h4', {} );
			h.textContent = section.title;
			wrap.append( h );
			for ( const step of section.steps ) {
				const stepCard = el( 'button', {
					class: 'wpdm-routines__picker-card',
					type: 'button',
				} );
				const main = el( 'span', {
					class: 'wpdm-routines__picker-card-main',
				} );
				const title = el( 'span', {
					class: 'wpdm-routines__picker-card-title',
				} );
				title.textContent = step.label;
				const meta = el( 'span', {
					class: 'wpdm-routines__picker-card-meta',
				} );
				meta.textContent =
					step.kind + ( step.id ? ` • ${ step.id }` : '' );
				main.append( title, meta );
				stepCard.append( main );
				stepCard.addEventListener( 'click', () => {
					close();
					resolve( step );
				} );
				wrap.append( stepCard );
			}
			card.append( wrap );
		}

		const cancel = el(
			'button',
			{ class: 'wpdm-routines__btn', type: 'button' },
			[ 'Cancel' ],
		);
		cancel.addEventListener( 'click', () => {
			close();
			resolve( null );
		} );
		card.append( cancel );
	} );
}
