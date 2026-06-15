# renderer/features

UI feature modules. Each feature is a self-contained folder grouping the
components, hooks, and stores for one domain area, with colocated tests:

```
features/<feature>/
  components/
    <Component>.tsx
    <Component>.test.tsx
  hooks/
    use<Thing>.ts
    use<Thing>.test.ts
  stores/
    <feature>.store.ts
```

Guidelines:

- Pages (`renderer/pages`) compose features; features should not import pages.
- Cross-feature primitives (Button, Input, ...) live in
  `renderer/shared/components/ui`, not inside a feature.
- Pure helpers go in `renderer/shared/helpers`; shared types in `src/shared/types`.
