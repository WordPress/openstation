# Components, About and AI provider setup

[Help index](index.md) · [Features](features.md) · [Actions](actions.md)

## Open a section or search Preferences

`open_section` accepts a currently available page id. Built-ins are `appearance`, `themes`, `windows`, `navigation`, `mobile`, `features`, `about`, and administrator-only `help` (labelled Components). Plugin-provided tabs can appear in the same page catalog; MIO can open them but their undocumented controls do not become authorized actions automatically.

`search_settings` filters the sidebar by text. Clearing the query restores all rows. It is a local view change, not a saved account preference.

## Components reference

Administrators can inspect the component kit on Components. `list_components` lists the available tags and titles. `open_component_reference` takes a known tag, opens Components and selects its documentation and interactive example. The examples demonstrate generic controls; operating a sample is not equivalent to modifying real application data. Developer mode can unlock additional demonstration surfaces.

## About

Open `about` with `open_section` to read the OpenStation version and journal. The page loads the journal when first shown. Journal links and external resources remain ordinary user navigation; MIO does not publish or send messages to those destinations.

## Connect an AI provider

MIO uses the site's existing WordPress AI Client and configured provider. To ask MIO, the personal AI assistant preference must be enabled and a compatible provider must be configured. The client gives a clear error when unavailable; it never pretends to have performed a change.

`show_connectors_location` returns the configured WordPress Connectors destination. Open WordPress **Settings → Connectors** and configure the provider there. Credentials stay in WordPress's connector configuration, not in MIO prompts or help documents. Do not paste keys into chat.

## Private actions

MIO's tools are scoped to a live window registration in the browser. They are neither `wp_register_ability()` registrations nor global slash-commands. WordPress's Abilities discovery and execution routes cannot discover these MIO actions. Server-backed changes still use normal authenticated REST/app actions and their capability checks: private discovery does not bypass authorization.
