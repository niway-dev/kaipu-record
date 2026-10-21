/**
 * Read ONLY by @stylexjs/postcss-plugin, which parses the files in its
 * `include` globs with this config to find stylex.create calls. Vite's own
 * React transform does not load config files (it gets its plugins inline in
 * vite.config.ts), so this cannot double-transform the app.
 */
module.exports = {
  presets: ["@babel/preset-typescript", ["@babel/preset-react", { runtime: "automatic" }]],
  plugins: [
    [
      "@stylexjs/babel-plugin",
      {
        dev: false,
        runtimeInjection: false,
        treeshakeCompensation: true,
        unstable_moduleResolution: { type: "commonJS" },
      },
    ],
  ],
};
