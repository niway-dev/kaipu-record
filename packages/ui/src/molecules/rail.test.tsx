import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Rail, type RailItem } from "./rail";

interface LinkItem extends RailItem {
  to: string;
}

const items: LinkItem[] = [
  { id: "record", label: "Record", icon: <i data-testid="icon-record" />, to: "/", active: true },
  { id: "library", label: "Library", icon: <i data-testid="icon-library" />, to: "/library" },
];

describe("Rail", () => {
  it("renders each item through renderLink with its label and icon", () => {
    render(
      <Rail
        brand={<b>mark</b>}
        items={items}
        renderLink={(item, props) => <a href={item.to} {...props} />}
      />,
    );
    const link = screen.getByRole("link", { name: /library/i });
    expect(link).toHaveAttribute("href", "/library");
    expect(link).toHaveAttribute("title", "Library");
    expect(screen.getByTestId("icon-library")).toBeInTheDocument();
  });

  it("works with a non-routing element", () => {
    render(
      <Rail
        brand={null}
        items={items}
        renderLink={(item, props) => <span data-id={item.id} {...props} />}
      />,
    );
    expect(screen.getAllByText(/record|library/i)).toHaveLength(2);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("marks only the active item as the current page and styles it differently", () => {
    render(
      <Rail
        brand={null}
        items={items}
        renderLink={(item, props) => <a href={item.to} {...props} />}
      />,
    );
    const active = screen.getByRole("link", { name: /record/i });
    const idle = screen.getByRole("link", { name: /library/i });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(idle).not.toHaveAttribute("aria-current");
    expect(active.className).not.toBe(idle.className);
  });

  it("shows the brand with its title", () => {
    render(
      <Rail
        brand={<b>mark</b>}
        brandTitle="Kaipu Record"
        items={[]}
        renderLink={(_, props) => <span {...props} />}
      />,
    );
    expect(screen.getByTitle("Kaipu Record")).toHaveTextContent("mark");
  });

  it("renders the account item in the footer, named by its label", () => {
    const account: LinkItem = { id: "account", label: "Account", icon: <i />, to: "/cloud" };
    render(
      <Rail
        brand={null}
        items={items}
        account={account}
        renderLink={(item, props) => <a href={item.to} {...props} />}
      />,
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/cloud");
  });

  it("omits the footer when there is no account", () => {
    render(
      <Rail
        brand={null}
        items={items}
        renderLink={(item, props) => <a href={item.to} {...props} />}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
