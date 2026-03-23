import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="Remove Blender?" description="Confirm" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("handles confirm, backdrop cancel, and escape interactions", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    const { unmount } = render(
      <ConfirmDialog
        open
        title="Remove Blender?"
        description={<p>Confirm the uninstall.</p>}
        errorMessage="Something went wrong"
        confirmLabel="Remove version"
        cancelLabel="Keep it"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove version" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("locks dismiss actions while confirming", () => {
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Remove Blender?"
        description="Confirm"
        isConfirming
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("button", { name: "Removing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("alertdialog").parentElement as HTMLElement);

    expect(onCancel).not.toHaveBeenCalled();
  });
});
