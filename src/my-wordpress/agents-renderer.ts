/**
 * My WordPress — Agents kind renderer (UX mock).
 *
 * Visual preview of the planned Agents surface. Every interaction is a
 * "Coming soon" stub or pure UI state — no LLM calls, no fetches, no
 * persistence. The shape this renderer establishes (left tile list +
 * always-present Create button + selection-driven right panel with
 * Define / Tools / Triggers sections) is the contract the backend work
 * in future PRs slots in behind without re-shooting the screens.
 *
 * @internal
 * @since 0.22.0
 */

import { __, sprintf } from '../i18n';
import type { EntityRenderer } from './kind-registry';
import {
	BOT_ICON_DATA_URI,
	MOCK_ABILITIES,
	MOCK_AGENTS,
	type AgentTrigger,
	type AgentTriggerKind,
	type MockAgent,
} from './agents-mock';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-checkbox/wpd-checkbox';
import '../ui/components/wpd-chip/wpd-chip';
import '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-textarea/wpd-textarea';
import '../ui/components/wpd-tile/wpd-tile';

interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

/** Dashicon glyph per trigger kind — used in the Triggers section. */
const TRIGGER_ICON: Record< AgentTriggerKind, string > = {
	drag: 'dashicons-move',
	chat: 'dashicons-format-chat',
	hook: 'dashicons-admin-plugins',
	endpoint: 'dashicons-rest-api',
	agent: 'dashicons-networking',
};

function openComingSoonDialog( message: string ): void {
	const fn = (
		window.wp as
			| {
					desktop?: {
						confirm?: ( o: ConfirmOptions ) => Promise< boolean >;
					};
				}
			| undefined
	)?.desktop?.confirm;
	if ( typeof fn === 'function' ) {
		void fn( {
			title: __( 'Coming soon', 'desktop-mode' ),
			message,
			confirmLabel: __( 'OK', 'desktop-mode' ),
			cancelLabel: '',
		} );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[my-wordpress/agents]', message );
}

function showToast( message: string ): void {
	const toast = (
		window.wp as
			| {
					desktop?: {
						toast?: ( o: { message: string } ) => void;
					};
				}
			| undefined
	)?.desktop?.toast;
	if ( typeof toast === 'function' ) {
		toast( { message } );
		return;
	}
	// eslint-disable-next-line no-console
	console.info( '[my-wordpress/agents]', message );
}

/**
 * Render the Agents section into the My WordPress window body.
 * Registered against the `'agents'` entity kind by `index.ts`.
 *
 * @public
 * @since 0.22.0
 */
export const renderAgentsKind: EntityRenderer = ( host ) => {
	const split = document.createElement( 'div' );
	split.className =
		'desktop-mode-my-wordpress__split desktop-mode-my-wordpress__agents';

	const left = document.createElement( 'div' );
	left.className =
		'desktop-mode-my-wordpress__list desktop-mode-my-wordpress__agents-list';
	const list = document.createElement( 'div' );
	list.className = 'desktop-mode-my-wordpress__agents-tiles';
	list.setAttribute( 'role', 'list' );
	left.appendChild( list );

	const right = document.createElement( 'div' );
	right.className =
		'desktop-mode-my-wordpress__preview desktop-mode-my-wordpress__agents-preview';

	const createRow = document.createElement( 'div' );
	createRow.className = 'desktop-mode-my-wordpress__agents-create';
	const createBtn = document.createElement( 'wpd-button' );
	createBtn.setAttribute( 'variant', 'primary' );
	createBtn.textContent = __( '+ Create agent', 'desktop-mode' );
	createBtn.addEventListener( 'click', () => {
		openComingSoonDialog(
			__(
				'Agent creation is in design — this Agents section is a UI preview only.',
				'desktop-mode',
			),
		);
	} );
	createRow.appendChild( createBtn );

	const detail = document.createElement( 'div' );
	detail.className = 'desktop-mode-my-wordpress__agents-detail';

	right.appendChild( createRow );
	right.appendChild( detail );

	split.appendChild( left );
	split.appendChild( right );
	host.body.appendChild( split );

	let selectedId: string | null = null;

	function paintList(): void {
		list.replaceChildren();
		for ( const agent of MOCK_AGENTS ) {
			const tile = document.createElement( 'wpd-tile' );
			tile.setAttribute( 'type', '__my-wordpress-agent' );
			tile.setAttribute( 'ref', agent.id );
			tile.setAttribute( 'label', agent.name );
			// Every agent tile shares the same bot glyph as the section
			// folder tile — visual consistency across the surface so
			// "all of these are agents" reads at a glance.
			tile.setAttribute( 'icon', BOT_ICON_DATA_URI );
			tile.setAttribute( 'kind', 'entry' );
			tile.classList.add(
				'desktop-mode-my-wordpress__tile',
				'desktop-mode-my-wordpress__tile--entry',
				'desktop-mode-my-wordpress__agent-tile',
			);
			tile.dataset.agentId = agent.id;
			if ( agent.id === selectedId ) {
				tile.setAttribute( 'selected', '' );
			}
			tile.addEventListener( 'click', () => {
				if ( selectedId === agent.id ) {
					return;
				}
				selectedId = agent.id;
				paintList();
				paintDetail();
			} );
			tile.addEventListener( 'dblclick', ( ev ) => {
				ev.preventDefault();
				showToast(
					sprintf(
						// translators: %s is the agent name.
						__(
							'Chat with %s — coming soon.',
							'desktop-mode',
						),
						agent.name,
					),
				);
			} );
			list.appendChild( tile );
		}
	}

	function paintDetail(): void {
		detail.replaceChildren();
		if ( ! selectedId ) {
			const empty = document.createElement( 'wpd-empty-state' );
			empty.setAttribute( 'icon', 'dashicons-superhero' );
			empty.setAttribute(
				'heading',
				__( 'Pick an agent', 'desktop-mode' ),
			);
			empty.setAttribute(
				'description',
				__(
					'Select an agent on the left to inspect its definition, tools, and triggers.',
					'desktop-mode',
				),
			);
			detail.appendChild( empty );
			return;
		}
		const agent = MOCK_AGENTS.find( ( a ) => a.id === selectedId );
		if ( ! agent ) {
			return;
		}
		detail.appendChild( buildAgentPanel( agent ) );
	}

	paintList();
	paintDetail();
};

function buildAgentPanel( agent: MockAgent ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'desktop-mode-my-wordpress__agent-panel';
	root.dataset.agentId = agent.id;

	root.appendChild( buildAgentHeader( agent ) );
	root.appendChild(
		buildSection( __( 'Define', 'desktop-mode' ), buildDefine( agent ) ),
	);
	root.appendChild(
		buildSection( __( 'Tools', 'desktop-mode' ), buildTools( agent ) ),
	);
	root.appendChild(
		buildSection(
			__( 'Triggers', 'desktop-mode' ),
			buildTriggers( agent ),
		),
	);

	return root;
}

function buildAgentHeader( agent: MockAgent ): HTMLElement {
	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__agent-header';

	// Same bot glyph used on the section + tile icons — one visual
	// motif across every surface that displays an agent. Rendered as
	// an <img> so the data-URI SVG paints crisply at large sizes (32px
	// in the header vs 32–48px on tiles).
	const iconHost = document.createElement( 'img' );
	iconHost.className = 'desktop-mode-my-wordpress__agent-header-icon';
	iconHost.src = BOT_ICON_DATA_URI;
	iconHost.alt = '';
	iconHost.setAttribute( 'aria-hidden', 'true' );
	header.appendChild( iconHost );

	const titleWrap = document.createElement( 'div' );
	titleWrap.className = 'desktop-mode-my-wordpress__agent-header-title';
	const h2 = document.createElement( 'h2' );
	h2.textContent = agent.name;
	const desc = document.createElement( 'p' );
	desc.textContent = agent.description;
	titleWrap.appendChild( h2 );
	titleWrap.appendChild( desc );
	header.appendChild( titleWrap );

	const role = document.createElement( 'wpd-chip' );
	role.setAttribute( 'tone', 'accent' );
	role.setAttribute( 'size', 'compact' );
	role.setAttribute( 'label', agent.roleLabel );
	header.appendChild( role );

	return header;
}

function buildSection( title: string, body: HTMLElement ): HTMLElement {
	const section = document.createElement( 'section' );
	section.className = 'desktop-mode-my-wordpress__agent-section';
	const h = document.createElement( 'h3' );
	h.textContent = title;
	section.appendChild( h );
	section.appendChild( body );
	return section;
}

function buildDefine( agent: MockAgent ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-define';

	const label = document.createElement( 'label' );
	label.className = 'desktop-mode-my-wordpress__agent-define-label';
	label.textContent = __( 'System prompt', 'desktop-mode' );
	wrap.appendChild( label );

	const prompt = document.createElement( 'wpd-textarea' );
	prompt.setAttribute( 'rows', '4' );
	prompt.setAttribute( 'readonly', '' );
	prompt.setAttribute( 'value', agent.systemPrompt );
	wrap.appendChild( prompt );

	return wrap;
}

function buildTools( agent: MockAgent ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-tools';

	const meta = document.createElement( 'p' );
	meta.className = 'desktop-mode-my-wordpress__agent-tools-meta';
	const enabled = new Set( agent.toolSlugs );
	meta.textContent = sprintf(
		// translators: 1: count of enabled abilities, 2: total abilities.
		__( '%1$d of %2$d abilities enabled', 'desktop-mode' ),
		enabled.size,
		MOCK_ABILITIES.length,
	);
	wrap.appendChild( meta );

	const ul = document.createElement( 'ul' );
	ul.className = 'desktop-mode-my-wordpress__agent-tools-list';
	for ( const ability of MOCK_ABILITIES ) {
		const li = document.createElement( 'li' );
		li.className = 'desktop-mode-my-wordpress__agent-tools-row';
		if ( enabled.has( ability.slug ) ) {
			li.classList.add(
				'desktop-mode-my-wordpress__agent-tools-row--on',
			);
		}
		const checkbox = document.createElement( 'wpd-checkbox' );
		checkbox.setAttribute( 'disabled', '' );
		if ( enabled.has( ability.slug ) ) {
			checkbox.setAttribute( 'checked', '' );
		}
		li.appendChild( checkbox );

		const body = document.createElement( 'div' );
		body.className = 'desktop-mode-my-wordpress__agent-tools-body';
		const code = document.createElement( 'code' );
		code.textContent = ability.slug;
		const help = document.createElement( 'small' );
		help.textContent = ability.description;
		body.appendChild( code );
		body.appendChild( help );
		li.appendChild( body );

		ul.appendChild( li );
	}
	wrap.appendChild( ul );

	return wrap;
}

function buildTriggers( agent: MockAgent ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__agent-triggers';

	const list = document.createElement( 'ul' );
	list.className = 'desktop-mode-my-wordpress__agent-triggers-list';
	for ( const trigger of agent.triggers ) {
		list.appendChild( buildTriggerRow( trigger ) );
	}
	wrap.appendChild( list );

	const add = document.createElement( 'wpd-button' );
	add.setAttribute( 'variant', 'secondary' );
	add.textContent = __( '+ Add trigger', 'desktop-mode' );
	add.addEventListener( 'click', () => {
		openComingSoonDialog(
			__(
				'Trigger configuration is in design — this Agents section is a UI preview only.',
				'desktop-mode',
			),
		);
	} );
	wrap.appendChild( add );

	return wrap;
}

function buildTriggerRow( trigger: AgentTrigger ): HTMLElement {
	const li = document.createElement( 'li' );
	li.className = 'desktop-mode-my-wordpress__agent-trigger';
	li.dataset.triggerKind = trigger.kind;

	const icon = document.createElement( 'span' );
	icon.className =
		'desktop-mode-my-wordpress__agent-trigger-icon dashicons ' +
		( TRIGGER_ICON[ trigger.kind ] ?? 'dashicons-flag' );
	icon.setAttribute( 'aria-hidden', 'true' );
	li.appendChild( icon );

	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-my-wordpress__agent-trigger-body';
	const summary = document.createElement( 'strong' );
	summary.textContent = trigger.summary;
	const detail = document.createElement( 'p' );
	detail.textContent = trigger.detail;
	body.appendChild( summary );
	body.appendChild( detail );
	li.appendChild( body );

	return li;
}
