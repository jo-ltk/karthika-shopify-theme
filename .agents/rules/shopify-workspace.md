# Shopify Theme Development — Workspace Rules

This is a **Shopify theme** project (Karthika). Always follow these rules when working in this workspace.

## Skills to Use

Always reference and use the following Shopify skills installed in `.agents/skills/`:

- **shopify-liquid** — For all Liquid templating, sections, blocks, and snippets
- **shopify-admin** — For Shopify Admin API (GraphQL) queries and mutations
- **shopify-storefront-graphql** — For Storefront API operations
- **shopify-dev** — For Shopify CLI, theme development, and deployment workflows
- **shopify-custom-data** — For metafields, metaobjects, and custom data
- **shopify-customer** — For customer account and authentication features
- **shopify-use-shopify-cli** — For Shopify CLI commands and workflows

When the task involves Liquid, sections, or theme code, always read the `shopify-liquid` SKILL.md first.
When the task involves Admin API, always read the `shopify-admin` SKILL.md first.

## Theme Development Guidelines

- Use **Liquid** as the primary templating language
- Follow Shopify's section and block architecture patterns
- Use **JSON templates** (not `.liquid` templates) where possible
- Write accessible, semantic HTML within Liquid templates
- Follow Shopify's CSS best practices for theme assets
- Use section schema for configurable settings
- Keep JavaScript minimal and progressive-enhancement friendly
