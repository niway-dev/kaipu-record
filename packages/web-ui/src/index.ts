// Export all components
export * from "./components/accordion";
export * from "./components/button";
export * from "./components/card";
export * from "./components/checkbox";
export * from "./components/dropdown-menu";
export * from "./components/input";
export * from "./components/label";
export * from "./components/markdown-content";
export * from "./components/skeleton";
export * from "./components/sonner";
export * from "./components/table";
export * from "./components/textarea";
export * from "./components/test-component";
export * from "./components/alert";
export * from "./components/badge";
export * from "./components/select";
export * from "./components/dialog";
export * from "./components/alert-dialog";

// Export utilities
export * from "./lib/utils";
export * from "./lib/normalize-markdown";

// NO side-effect CSS import here. The app owns the single Tailwind build:
// its index.css @imports this package's styles.css SOURCE, whose @source
// directives make the app's build scan these components and generate every
// class they use. Importing styles.css here (with libInjectCss) shipped a
// SECOND full utilities layer inside dist, which is the duplicated-cascade
// bug the hub documents in web/tailwind-v4-split-css-cascade.md.
