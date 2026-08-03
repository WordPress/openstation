/**
 * os-ui — in-product component help descriptors.
 *
 * Every `<os-*>` component may declare a `static help: OsHelp`
 * descriptor on its class. Those descriptors power the Help tab in
 * OS Settings (developer-facing, admin-gated) so plugin authors can
 * browse the component library without leaving WordPress.
 *
 * Keeping help metadata on the class — rather than in a separate
 * docs file — means:
 *
 *   - It ships with the component at runtime (no build step).
 *   - It is type-checked against the real component.
 *   - It cannot drift silently: renaming a prop forces a descriptor
 *     update if the help table asserts on it.
 *
 * Components without a descriptor still appear in the Help tab with
 * a fallback rendering built from `static props`; the descriptor is
 * how authors enrich that baseline.
 */

import type { TemplateResult } from './html';

/** Stability contract label, borrowed from `docs/hooks-reference.md`. */
export type OsHelpStatus = 'stable' | 'experimental' | 'planned';

export interface OsHelpProp {
	name: string;
	type?: string;
	default?: string;
	description?: string;
}

export interface OsHelpSlot {
	/** Slot name; use `'(default)'` for the unnamed default slot. */
	name: string;
	description?: string;
}

export interface OsHelpPart {
	name: string;
	description?: string;
}

export interface OsHelpCssProp {
	name: string;
	description?: string;
	default?: string;
}

export interface OsHelpEvent {
	name: string;
	description?: string;
	/** One-line shape hint for the event's `detail` payload. */
	detail?: string;
}

export interface OsHelp {
	/** Human-readable title — e.g., `'Button'`. Defaults to the tag name. */
	title?: string;
	/** One-paragraph summary. Keep short; examples carry the nuance. */
	summary?: string;
	/** Stability label. Defaults to `'stable'` when omitted. */
	status?: OsHelpStatus;
	/** Semver the component first shipped in (e.g. `'0.9.0'`). */
	since?: string;
	props?: readonly OsHelpProp[];
	slots?: readonly OsHelpSlot[];
	parts?: readonly OsHelpPart[];
	cssProps?: readonly OsHelpCssProp[];
	events?: readonly OsHelpEvent[];
	/**
	 * Live example rendered inside the Help panel. Must be a plain
	 * `html\`\`` template — the panel renders it into an isolated
	 * container so the example can exercise the real component.
	 */
	example?: TemplateResult;
}
