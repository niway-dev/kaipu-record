import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UploadModePicker } from "./upload-mode-picker";

describe("UploadModePicker", () => {
  it("renders three mutually exclusive options in one radio group", () => {
    render(<UploadModePicker mode="local-only" cloudBlocker={null} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Save mode" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /local only/i })).toBeChecked();
  });

  it("reports the chosen mode", () => {
    const onChange = vi.fn();
    render(<UploadModePicker mode="local-only" cloudBlocker={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /manual upload/i }));
    expect(onChange).toHaveBeenCalledWith("manual");
  });

  it("disables cloud modes without an account, explains why, and keeps local usable", () => {
    render(<UploadModePicker mode="local-only" cloudBlocker="signed-out" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /local only/i })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /manual upload/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /automatic upload/i })).toBeDisabled();
    expect(screen.getByText(/sign in to use cloud/i)).toBeInTheDocument();
  });

  it("keeps a saved cloud mode checked while signed out, and says it is waiting", () => {
    render(<UploadModePicker mode="manual" cloudBlocker="signed-out" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /manual upload/i })).toBeChecked();
    expect(screen.getByText(/wait until you sign in/i)).toBeInTheDocument();
  });

  it("warns that automatic upload is not retroactive and is per device", () => {
    render(<UploadModePicker mode="automatic" cloudBlocker={null} onChange={() => {}} />);
    expect(screen.getByText(/will not upload existing files/i)).toBeInTheDocument();
  });

  it("checks nothing while settings are loading", () => {
    render(<UploadModePicker mode={null} cloudBlocker={null} onChange={() => {}} />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });
  it("unverified email: cloud modes disabled with the verify-email reason", () => {
    render(
      <UploadModePicker mode="local-only" cloudBlocker="email-unverified" onChange={() => {}} />,
    );
    expect(screen.getByRole("radio", { name: /manual upload/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /automatic upload/i })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/verify your email to use cloud/i);
  });
});
