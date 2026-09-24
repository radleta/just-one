# just-one-expert Wiki — Schema

## Page Types
- **Knowledge page**: Core domain content with frontmatter (tags, summary, plus any per-domain required fields)

## Conventions
- Filenames: kebab-case, descriptive
- Links: standard markdown (`[Page](page.md)`)
- Frontmatter: `tags` and `summary` required on all knowledge pages; additional required fields declared in this schema.md
- Citations: a literal markdown link whose target is the file, with the stable token (function, identifier, heading, literal string) named in the anchor text — never a line number, in either half

## Tag Prefix

Every knowledge page's `tags:` value opens with this domain's prefix:

```yaml
tags: [just-one-expert/{subtopic}]
summary: "One-line description of the page"
```

## Where knowledge lives

| Home | Holds | Never holds |
|---|---|---|
| `README.md` | What a user of the CLI needs: usage, options, behavior they can observe | Agent working knowledge |
| `CLAUDE.md` | Only what must be in context on every turn (hard safety rules), plus short pointers into this wiki | Explanations, rationale, how-tos. Those go on a page, and `CLAUDE.md` links to it |
| `CHANGELOG.md`, config files, code comments | What they own today | Copies of wiki content |
| This wiki | Agent working knowledge: cross-file rules, platform traps, test and release procedures, decisions and their reasons | Copies of anything a repo file owns |

One fact, one place. When a repo file owns a fact (a doc section, `package.json`, a workflow step,
a doc comment), the page links to it by file and a stable token and does not restate it. When the
wiki owns a fact, other files point here and do not restate it. When you find the same fact in two
places, delete one copy and link to the other. Do not reconcile the wording of two copies.

This wiki is committed to a public repository. A page never names or links a private repository,
a private project, a person's private details, or anything in the untracked `scratch` directory. A user-level skill
may be named, as plain text, as the place a general rule lives. It may not be linked or quoted.

## Evolution
Review and update this schema after every 10-20 ingests.
