/**
 * Local ESLint rules for the wp-desktop-mode codebase.
 *
 * Wired into `.eslintrc.cjs` via `eslint-plugin-local-rules`. Add new
 * rules by exporting them from this object — the plugin exposes them
 * under the `local-rules/<key>` namespace.
 */
module.exports = {
	'wpd-component-registration': require('./wpd-component-registration.cjs'),
};
