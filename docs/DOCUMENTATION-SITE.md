---
layout: default
title: Maintaining the Documentation Site
parent: Development
nav_order: 6
---

# Maintaining The Documentation Site

The public Markdown files in `docs/` are also the source for
[docs.agentifui.com](https://docs.agentifui.com). GitHub Pages builds them with
Jekyll and the version-pinned Just the Docs remote theme. The application does
not need Ruby, Jekyll, a documentation server, or additional Node dependencies.

## Content And Navigation

- Edit the existing Markdown rather than keeping separate website copies.
- Keep YAML front matter at the beginning of each page. Set `layout: default`, `title` and
  `nav_order`; child pages also set `parent` to the parent's exact title.
- The documentation `README.md` uses `permalink: /` as the website homepage.
- Use relative Markdown links for pages within `docs/`. The supported
  `jekyll-relative-links` plugin converts them into website links.
- Link to files outside `docs/` using their public GitHub URLs. They are not
  included in the website source directory.
- Match heading fragments to the actual generated page. Do not hide broken
  links by disabling checks.
- Put site configuration in `_config.yml`. When changing the remote theme,
  choose and validate an explicit release tag instead of tracking its main branch.

Do not put credentials, environment files, internal records, user data, or
deployment-specific configuration under the website source. Static assets in
`docs/` can be published even when no navigation link points to them. The public
documentation hostname and `CNAME` are intentional public configuration, not
application runtime settings.

## GitHub Pages Publishing

In the repository's **Settings > Pages**, choose **Deploy from a branch**, then
select **main** and **/docs**. No custom publishing workflow, generated HTML
commit, or separate publication branch is required. Normal pull requests merge
documentation into main; GitHub Pages then builds and deploys the site.

The domain owner must create this DNS record:

| Type  | Name   | Target             |
| ----- | ------ | ------------------ |
| CNAME | `docs` | `iflabx.github.io` |

Use a DNS-only record when a DNS provider also offers proxying. Remove any
conflicting A, AAAA or CNAME record for the same name. Do not point this name at
an application server or include the repository path in the CNAME target.

Set the repository's **Custom domain** to `docs.agentifui.com`; keep the matching
`docs/CNAME` in Git. After DNS verification and GitHub certificate provisioning,
enable **Enforce HTTPS**. No manually installed certificate or application
reverse proxy is needed. If GitHub reports that the domain is already claimed,
resolve ownership or the conflicting Pages site rather than changing app routes.
Organization domain verification is available as an additional ownership control;
copy any requested TXT record from GitHub instead of inventing a verification value.

`_config.yml` uses `url: "https://docs.agentifui.com"` and an empty `baseurl`, since
the custom domain serves the website from `/`. Without a custom domain, the
project site's URL and base path must instead match its GitHub Pages address.

## Validation And Delivery Boundaries

Before publishing, check the Jekyll build, navigation, generated internal links
and heading anchors, search data, mobile layout, and the absence of private
content. Check both the generated website and the Markdown view on GitHub.
When validating locally, keep temporary dependencies and generated files outside
the checkout, or use an isolated build environment. Do not commit `_site`,
`.jekyll-cache`, `.jekyll-metadata`, or dependency directories.

The first deployment also needs the domain's DNS and GitHub Pages settings;
adding `url` and `CNAME` alone does not activate hosting or HTTPS. Check the
repository's Pages deployment result and the public HTTPS address after setup.

This site tracks main and can describe unreleased functionality; it is not a
multi-version documentation archive. Documentation publishing does not deploy
the AgentifUI application, change Stage, run migrations, or create a product
Release. Existing application CI and release rules remain unchanged.
