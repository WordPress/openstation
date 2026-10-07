import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CSS = readFileSync(resolve(ROOT, "assets/css/chromeless.css"), "utf8");
const PHP = readFileSync(resolve(ROOT, "includes/themes-tabs.php"), "utf8");

const WORKSPACE_START = CSS.indexOf(".os-chromeless.themes-php #wpbody-content {");
const WORKSPACE_CSS = CSS.slice(WORKSPACE_START);
const COMPACT_WORKSPACE_CSS = WORKSPACE_CSS.replace(/\s+/g, " ");

describe("WordPress Themes workspace", () => {
	test("the redesign is present and cannot leak into classic admin", () => {
		expect(WORKSPACE_START).toBeGreaterThan(-1);

		const withoutComments = WORKSPACE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
		const selectors = Array.from(
			withoutComments.matchAll(/([^{}]+)\{/g),
			(match) => match[1].trim(),
		).filter((selector) => selector && !selector.startsWith("@"));

		for (const selector of selectors) {
			for (const part of selector.split(",")) {
				expect(part.trim()).toMatch(/^\.os-chromeless\.themes-php\b/);
			}
		}
	});

	test("single-theme mode becomes a screenshot-led workspace with visible actions", () => {
		expect(COMPACT_WORKSPACE_CSS).toContain(
			"#wpbody-content { padding: 10px 16px;",
		);
		expect(COMPACT_WORKSPACE_CSS).toContain(
			".themes.single-theme .theme-overlay.active .theme-wrap",
		);
		expect(COMPACT_WORKSPACE_CSS).toContain('"screenshot details"');
		expect(COMPACT_WORKSPACE_CSS).toMatch(
			/\.themes\.single-theme[^{]+\.theme-actions\s*\{[^}]*position:\s*static;/s,
		);
		expect(COMPACT_WORKSPACE_CSS).toMatch(
			/\.theme-actions \.inactive-theme\s*\{[^}]*display:\s*none;/s,
		);
	});

	test("multiple themes use a responsive grid and retain a fitted details dialog", () => {
		expect(COMPACT_WORKSPACE_CSS).toContain(".themes:not(.single-theme)");
		expect(COMPACT_WORKSPACE_CSS).toContain(
			"grid-template-columns: repeat(auto-fit",
		);
		expect(COMPACT_WORKSPACE_CSS).toContain(
			".theme-overlay.active .theme-header",
		);
		expect(COMPACT_WORKSPACE_CSS).toMatch(
			/\.theme-overlay\.active \.theme-wrap\s*\{[^}]*left:\s*18px;/s,
		);
	});

	test("the page keeps WordPress admin colours instead of shell theme tokens", () => {
		expect(WORKSPACE_CSS).not.toContain("--os-ui-");
		expect(COMPACT_WORKSPACE_CSS).toContain(
			"var(--wp-admin-theme-color, #2271b1)",
		);
	});

	test("the orientation header is gated to the chromeless Themes screen", () => {
		expect(PHP).toContain(
			"function openstation_render_themes_workspace_intro()",
		);
		expect(PHP).toContain(
			"add_action( 'admin_notices', 'openstation_render_themes_workspace_intro', 0 )",
		);
		expect(PHP).toContain('class="openstation-themes-intro"');
	});

	test("the header keys off the screen ID rather than $pagenow", () => {
		expect(PHP).toContain("'themes' !== $screen->id");
		expect(PHP).not.toContain("'themes.php' !== $GLOBALS['pagenow']");
	});
});
