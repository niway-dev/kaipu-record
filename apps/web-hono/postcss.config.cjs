/**
 * Only here for StyleX: the plugin scans these files for stylex.create calls
 * and writes the generated atomic CSS where a stylesheet says `@stylex;`
 * (src/stylex.css). Tailwind v4 does NOT run through this config — its Vite
 * plugin owns its own pipeline — so the two systems coexist without touching.
 */
module.exports = {
  plugins: {
    "@stylexjs/postcss-plugin": {
      // Only where stylex.create lives. The plugin parses these with its own
      // Babel (no TS config of ours), so a broad glob chokes on generated TS
      // like routeTree.gen.ts — and scanning the world is wasted work anyway.
      include: ["../../packages/ui/src/**/*.{ts,tsx}", "src/routes/dev/**/*.{ts,tsx}"],
    },
  },
};
