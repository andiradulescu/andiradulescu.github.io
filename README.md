# Hi there, I'm Andi! 👋

My blog at <https://andiradulescu.github.io>, built with [AstroPaper](https://github.com/satnaing/astro-paper) and deployed to GitHub Pages.

## Local development

Use Node 24 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Before publishing, run:

```sh
pnpm lint
pnpm format:check
pnpm build
pnpm preview
```

The build checks Astro/TypeScript, generates the static site, and indexes it with Pagefind. Google Fonts are fetched at build time and served locally to readers.

## Publishing

Read [PUBLISHING.md](PUBLISHING.md) when drafting, editing, or publishing an article. Posts live in `src/content/posts/`. A push to `main` validates, builds, and deploys the site through `.github/workflows/deploy.yml`. Pull requests build without deploying.

GitHub Pages must use **GitHub Actions** as its source. The public address is `https://andiradulescu.github.io/`; no custom domain or DNS changes are required.

Future-dated posts are included only when a build runs after their publication time. There is no scheduled publishing job.

## Theme provenance

Based on AstroPaper 6.1.0, upstream commit `35cfa7fbe0b897306d27670d3819e55d5205f3dd`. The original MIT license is preserved in [LICENSE](LICENSE). Theme updates are deliberate dependency changes, validated before publication.
