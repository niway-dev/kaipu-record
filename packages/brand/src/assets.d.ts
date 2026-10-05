/**
 * Image imports resolve to a bundler-emitted URL. Declared here because this
 * package is consumed as source by two different bundlers (Vite for the web,
 * electron-vite for the desktop) and neither one's ambient types reach it.
 */
declare module "*.webp" {
  const src: string;
  export default src;
}
