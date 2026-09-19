# Publishing

## Draft an article

Keep unapproved drafts outside this public repository. Show Andi the complete draft before publishing. A `draft: true` file is excluded from the website, but its contents remain public in Git history.

Write from the session's evidence: the problem, relevant environment and revision, commands, failed approaches, actual fix, and verification. Keep uncertainty and untested claims explicit. Use plain language, concrete details, and no em dashes. Avoid invented results, generic tutorial padding, or a content schedule.

For retrospective posts, read the relevant original Codex and Claude conversations as well as the code, branches, commits, and PR discussions. Preserve the requested scope: distinguish separate attempts and implementation stages instead of mixing later work into an earlier story. Include what went wrong and where the work stopped; an unsuccessful attempt is still worth documenting. Attribute collaborators and AI-assisted stages accurately when they are part of the story, and distinguish local results, published fork work, upstream rejection, and upstream acceptance.

Exclude secrets, credentials, private conversations, personal data, and confidential client or employer material. Publish only the approved public account of the work.

## Structure and voice

- Start with a short introduction explaining the problem and what the post covers before the technical sections.
- Write a readable account, not a session transcript or engineering status report. Long posts are fine when the subject needs them, but cut repetition and unrelated incidents, such as a relay malfunction in a camera-driver story.
- Use direct descriptions of actions and observations. Prefer “Our test was comparing different frames” to “The test itself had created an apparent coherency failure.” Avoid contrived hooks such as “a speaker that was almost exactly 256 times too quiet”; state the measured difference in the relevant technical section instead.
- Remove generic transitions, self-congratulatory commentary, and lessons that merely repeat what the debugging already demonstrates. End with the actual result and remaining work, without an added moral or grand summary.
- Use familiar product names in prose. For openpilot hardware, use comma 3, comma 3X, and comma four rather than explaining the tici, tizi, and mici board codenames. Keep exact identifiers where needed in commands, paths, and code.
- Round measurements in narrative prose when extra decimals add no explanatory value, for example 29.5 ms instead of 29.458 ms. Preserve precision when it matters to reproduction or the technical claim.
- For a series, keep each part focused on its stage and make the chronology clear. Respect approved titles; distinguish related installments with a short qualifier rather than unnecessarily renaming the topic.

## Links and supporting evidence

Use public, durable links for schematics, source files, commits, and PRs. Replace local-only filenames and filesystem links with the existing public source where available; inspect the target to confirm it is the same artifact.

When describing branch work, include GitHub compare links from the relevant upstream baseline, such as `master`, to the actual working branch. Use concise repository labels such as `dorapilot/openpilot`. Verify repository and branch names rather than assuming every component uses the same branch. Refresh status claims and supporting links when later commits are pushed or the evidence changes.

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

Replace the example date with the date agreed for the article. Default to the actual publication date for new work. For historical write-ups and series, Andi has requested dates aligned with the work rather than the upload date: check the conversation, commit, and PR chronology, propose a date after the events covered, and use the approved date. Keep installment order and “as of” wording consistent; do not apply a one-off backdating request to every post or move an article before events it describes.

The author defaults to Andi Radulescu. Add `modDatetime` when substantially updating a published article, preserving the agreed `pubDatetime` unless Andi requests a date correction. The content schema in `src/content.config.ts` defines supported metadata. Put article images under `src/assets/images/` and reference them from Markdown; descriptive alt text is required.

Run the README validation commands and preview the rendered article. Check code blocks, links, images, search results, RSS, and the generated social image. Review the complete diff and ensure that only approved public material will be committed.

## Publish

“Draft this” authorizes preparing a draft only. “Publish this” authorizes committing and pushing the approved version to `main`; if the article changes substantively afterward, show the revision before publishing. Preserve unrelated work and stage only the article and its required assets.

Use a descriptive commit message, push, and inspect the GitHub Actions deployment for that exact commit. Fetch the live article at `https://andiradulescu.github.io/posts/<filename-without-extension>` and check its content before returning the URL. A successful local build is not deployment confirmation. Report failed deployment, DNS, or HTTPS checks explicitly.

Pull request and issue mutations require Andi's separate confirmation of the exact target, text/state change, and command.
