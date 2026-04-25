# RaceCor.io Component Library

Shared React component library built with Storybook for visual development and documentation.

## Tech Stack

- React 19
- Storybook (`.storybook/` config)
- TypeScript (`tsconfig.json`)

## Structure

```
src/
  stories/    # Component stories (Storybook)
```

## Running

```bash
npm install
npx storybook dev    # Start Storybook dev server
```

## Relationship to Other Projects

These components are shared across the `web/` project. The component library is developed in isolation via Storybook and consumed as imports by the Next.js app.
