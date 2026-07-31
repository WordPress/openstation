/**
 * wpd-ui — in-product component help descriptors.
 *
 * Every `<wpd-*>` component may declare a `static help: WpdHelp`
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
export type WpdHelpStatus = 'stable' | 'experimental' | 'planned';

export interface WpdHelpProp {
	name: string;
	type?: string;
	default?: string;
	description?: string;
}

export interface WpdHelpSlot {
	/** Slot name; use `'(default)'` for the unnamed default slot. */
	name: string;
	description?: string;
}

export interface WpdHelpPart {
	name: string;
	description?: string;
}

export interface WpdHelpCssProp {
	name: string;
	description?: string;
	default?: string;
}

export interface WpdHelpEvent {
	name: string;
	description?: string;
	/** One-line shape hint for the event's `detail` payload. */
	detail?: string;
}

export interface WpdHelp {
	/** Human-readable title — e.g., `'Button'`. Defaults to the tag name. */
	title?: string;
	/** One-paragraph summary. Keep short; examples carry the nuance. */
	summary?: string;
	/** Stability label. Defaults to `'stable'` when omitted. */
	status?: WpdHelpStatus;
	/** Semver the component first shipped in (e.g. `'0.9.0'`). */
	since?: string;
	props?: readonly WpdHelpProp[];
	slots?: readonly WpdHelpSlot[];
	parts?: readonly WpdHelpPart[];
	cssProps?: readonly WpdHelpCssProp[];
	events?: readonly WpdHelpEvent[];
	/**
	 * Live example rendered inside the Help panel. Must be a plain
	 * `html\`\`` template — the panel renders it into an isolated
	 * container so the example can exercise the real component.
	 */
	example?: TemplateResult;
}
