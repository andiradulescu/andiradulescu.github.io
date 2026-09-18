# Publishing

## Draft an article

Keep unapproved drafts outside this public repository. Show Andi the complete draft before publishing. A `draft: true` file is excluded from the website, but its contents remain public in Git history.

Write from the session's evidence: the problem, relevant environment and revision, commands, failed approaches, actual fix, and verification. Keep uncertainty and untested claims explicit. Use plain language, concrete details, and no em dashes. Avoid invented results, generic tutorial padding, or a content schedule.

Exclude secrets, credentials, private conversations, personal data, and confidential client or employer material. Publish only the approved public account of the work.

## Prepare the approved version

Create `src/content/posts/descriptive-stable-slug.md`. Use lowercase hyphenated filenames and preserve them after publication because they determine URLs. Prefer Markdown; use MDX only when an article needs a component.

```yaml
---
title: "A concrete title"
description: "A short, factual summary."
pubDatetime: 2026-09-18T12:00:00Z
tags:
  - debugging
draft: false
featured: false
---
```

Replace the example date with the actual publication time. The author defaults to Andi Radulescu. Add `modDatetime` when substantially updating a published article, preserving `pubDatetime`. The content schema in `src/content.config.ts` defines supported metadata. Put article images under `src/assets/images/` and reference them from Markdown; descriptive alt text is required.

Run the README validation commands and preview the rendered article. Check code blocks, links, images, search results, RSS, and the generated social image. Review the complete diff and ensure that only approved public material will be committed.

## Publish

“Draft this” authorizes preparing a draft only. “Publish this” authorizes committing and pushing the approved version to `main`; if the article changes substantively afterward, show the revision before publishing. Preserve unrelated work and stage only the article and its required assets.

Use a descriptive commit message, push, and inspect the GitHub Actions deployment for that exact commit. Fetch the live article at `https://andiradulescu.github.io/posts/<filename-without-extension>` and check its content before returning the URL. A successful local build is not deployment confirmation. Report failed deployment, DNS, or HTTPS checks explicitly.

Pull request and issue mutations require Andi's separate confirmation of the exact target, text/state change, and command.
