import type { ReactNode } from "react";

/**
 * A stand-in for the router's `Link`: a plain anchor, so component tests can assert where a link
 * goes without mounting a router. Use inside `vi.mock("@tanstack/react-router", ...)`.
 */
export function MockLink({
  to,
  children,
  search: _search,
  activeProps: _activeProps,
  activeOptions: _activeOptions,
  ...rest
}: {
  to: string;
  children?: ReactNode;
  search?: unknown;
  activeProps?: unknown;
  activeOptions?: unknown;
  [key: string]: unknown;
}) {
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}
