import { throwOnRegistrationErrors } from './registration-errors';

export interface CommandAdminLink {
	title: string;
	url: string;
	description: string;
	icon: string;
}

export interface CommandEntity {
	id: number;
	type: 'post' | 'page' | 'comment';
	title?: string;
	url: string;
	edit_url: string;
	topic?: string;
	ai_summary?: string;
}

export interface CommandContext {

	close(): void;

	openInWindow( url: string, title: string, icon?: string ): void;

	confirm( message: string, details?: string ): Promise< boolean >;

	notify?: ( message: string ) => void;
}

export type CommandResult =
	| void
	| string
	| {
		message: string;
		answer_type?: 'chat' | 'navigation' | 'entity';
		admin_links?: CommandAdminLink[];
		entity?: CommandEntity | null;
	};

export interface CommandSuggestion {

	value: string;

	label: string;

	description?: string;

	icon?: string;
}

export interface DesktopCommand {

	slug: string;

	label: string;

	description?: string;

	hint?: string;

	icon?: string;

	iconSvg?: string;

	eager?: boolean;

	owner?: string;

	aiCallable?: boolean;

	suggest?: (
		args: string,
		ctx: CommandContext,
	) => CommandSuggestion[] | Promise< CommandSuggestion[] >;

	run( args: string, ctx: CommandContext ): CommandResult | Promise<CommandResult>;
}

const COMMAND_SLUG = /^[a-z0-9_/-]+$/;

import { createSharedStore } from './shared-store';

interface CommandRegistryState {
	registry: Map< string, DesktopCommand >;
	listeners: Set<() => void >;
}

const commandRegistryStore = createSharedStore< CommandRegistryState >(
	'desktop-mode/commands-registry',
	() => ( {
		registry: new Map< string, DesktopCommand >(),
		listeners: new Set<() => void >(),
	} ),
);
const registry = commandRegistryStore.state.registry;
const listeners = commandRegistryStore.state.listeners;

export function registerCommand( cmd: DesktopCommand ): void {
	const errors: string[] = [];
	const slug = typeof cmd?.slug === 'string' ? cmd.slug.trim().toLowerCase() : '';

	if ( ! cmd || typeof cmd !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof cmd.slug !== 'string' || cmd.slug.trim() === '' ) {
			errors.push( 'slug (missing)' );
		} else if ( ! COMMAND_SLUG.test( slug ) ) {
			errors.push(
				`slug (must match ${ COMMAND_SLUG } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof cmd.label !== 'string' || cmd.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof cmd.run !== 'function' ) {
			errors.push( 'run (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'Command', errors, cmd );

	registry.set( slug, { ...cmd, slug } );
	notify();
}

export function unregisterCommand( slug: string ): void {
	if ( registry.delete( slug.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ slug, cmd ] of Array.from( registry.entries() ) ) {
		if ( cmd.owner === owner ) {
			registry.delete( slug );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

export function listCommands(): DesktopCommand[] {
	return Array.from( registry.values() );
}

export function listAiCallableCommands(): Array< {
	slug: string;
	label: string;
	description: string;
	hint: string;
} > {
	const out: Array< {
		slug: string;
		label: string;
		description: string;
		hint: string;
	} > = [];
	for ( const cmd of registry.values() ) {
		if ( cmd.aiCallable !== true ) {
			continue;
		}
		out.push( {
			slug: cmd.slug,
			label: cmd.label,
			description: cmd.description ?? '',
			hint: cmd.hint ?? '',
		} );
	}
	return out;
}

export function listEagerCommands(): DesktopCommand[] {
	return Array.from( registry.values() ).filter( ( c ) => c.eager === true );
}

export function findCommand( slug: string ): DesktopCommand | null {
	return registry.get( slug.toLowerCase() ) ?? null;
}

export function filterCommands( query: string ): DesktopCommand[] {
	const q = query.trim().toLowerCase();
	if ( q === '' ) {
		return listCommands();
	}
	return listCommands().filter(
		( c ) =>
			c.slug.toLowerCase().startsWith( q ) ||
			c.label.toLowerCase().includes( q ),
	);
}

export function subscribeCommands( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] command-registry listener threw:', err );
			}
		}
	}
}

export interface ParsedCommandInput {
	isCommand: boolean;
	slug: string;
	args: string;
	hasArgsPart: boolean;
}

export function parseCommandInput( input: string ): ParsedCommandInput {
	if ( ! input.startsWith( '/' ) ) {
		return { isCommand: false, slug: '', args: '', hasArgsPart: false };
	}
	const rest = input.slice( 1 );
	const spaceIdx = rest.indexOf( ' ' );
	if ( spaceIdx === -1 ) {
		return { isCommand: true, slug: rest, args: '', hasArgsPart: false };
	}
	return {
		isCommand: true,
		slug: rest.slice( 0, spaceIdx ),
		args: rest.slice( spaceIdx + 1 ),
		hasArgsPart: true,
	};
}
