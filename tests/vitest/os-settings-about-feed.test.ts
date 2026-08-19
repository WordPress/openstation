import { beforeEach, describe, expect, test } from "vitest";
import {
	normalizeAboutFeed,
	paintAboutSection,
	type AboutFeed,
} from "../../src/settings/sections/about";

const feed: AboutFeed = {
	title: "OpenStation",
	description: "The build diary.",
	homeUrl: "https://openstation.blog/",
	feedUrl: "https://openstation.blog/feed/",
	stale: false,
	items: [
		{
			title: "<img src=x onerror=alert(1)> The newest dispatch",
			url: "https://openstation.blog/newest/",
			author: "OpenStation Crew",
			publishedAt: "2026-08-19T12:00:00+00:00",
			excerpt: "A look behind the latest build.",
		},
		{
			title: "A second dispatch",
			url: "https://openstation.blog/second/",
			author: "",
			publishedAt: "",
			excerpt: "",
		},
	],
};

describe("OS Settings — About journal", () => {
	let wrapper: HTMLElement;

	beforeEach(() => {
		wrapper = document.createElement("div");
		document.body.replaceChildren(wrapper);
	});

	test("validates links, required fields, and the five-post ceiling", () => {
		const items = Array.from({ length: 6 }, (_value, index) => ({
			title: `Post ${index + 1}`,
			url: `https://openstation.blog/post-${index + 1}/`,
		}));
		items.unshift({
			title: "Unsafe post",
			url: "javascript:alert(1)",
		});

		const normalized = normalizeAboutFeed({ items });
		expect(normalized).not.toBeNull();
		expect(normalized?.items).toHaveLength(5);
		expect(normalized?.items.map((item) => item.title)).not.toContain(
			"Unsafe post",
		);
		expect(normalized?.homeUrl).toBe("https://openstation.blog/");
	});

	test("renders the newest post as the feature and keeps remote text inert", () => {
		paintAboutSection(
			wrapper,
			{ pluginUrl: "https://example.com/plugin", pluginVersion: "1.1.0" },
			{ kind: "ready", feed },
		);

		const featured = wrapper.querySelector<HTMLAnchorElement>(
			".os-settings__about-featured > a",
		);
		expect(featured?.href).toBe("https://openstation.blog/newest/");
		expect(featured?.target).toBe("_blank");
		expect(featured?.rel).toBe("noopener noreferrer");
		expect(featured?.querySelector("h3")?.textContent).toContain(
			"<img src=x onerror=alert(1)>",
		);
		expect(featured?.querySelector("h3 img")).toBeNull();
		expect(wrapper.textContent).toContain("The build diary.");
		expect(wrapper.textContent).toContain("A desktop for WordPress.");
		expect(wrapper.textContent).toContain("OpenStation 1.1.0");
		expect(wrapper.textContent).toContain("An experiment by Automattic");
		expect(wrapper.textContent).toContain("Latest from the station");
		expect(
			wrapper
				.querySelector(".os-settings__about-overview")
				?.compareDocumentPosition(
					wrapper.querySelector(".os-settings__about-feed") as Node,
				) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			wrapper.querySelectorAll(".os-settings__about-card"),
		).toHaveLength(1);
	});

	test("renders loading, error, and stale states explicitly", () => {
		paintAboutSection(wrapper, {}, { kind: "loading" });
		expect(wrapper.textContent).toContain("Opening the journal…");

		paintAboutSection(wrapper, {}, { kind: "error" });
		expect(wrapper.textContent).toContain("could not be reached");
		expect(wrapper.textContent).toContain("RSS feed");

		paintAboutSection(
			wrapper,
			{},
			{
				kind: "ready",
				feed: { ...feed, stale: true },
			},
		);
		expect(wrapper.textContent).toContain("last saved copy");
	});
});
