import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpSettingsDialog } from "./McpSettingsDialog";
import { getMcpSettings, setMcpSettings } from "../lib/api";

vi.mock("../lib/api", () => ({ getMcpSettings: vi.fn(), setMcpSettings: vi.fn() }));
const saved = { enabled: false, port: 47831, token: "test-token", running: false, error: null };

describe("MCP settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getMcpSettings).mockResolvedValue(saved);
  });

  it("loads, validates, saves, refreshes status, and closes", async () => {
    vi.mocked(setMcpSettings).mockResolvedValue({ ...saved, enabled: true, running: true, port: 49000 });
    const close = vi.fn();
    const onSaved = vi.fn();
    render(<McpSettingsDialog onClose={close} onSaved={onSaved} />);
    const toggle = await screen.findByRole("switch", { name: "Enable MCP server" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(screen.getByLabelText("Connection URL")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "49000" } });
    expect(screen.getByLabelText("Connection URL")).toHaveValue("http://127.0.0.1:49000/mcp");
    expect(screen.getByText("Save settings to use this URL.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(setMcpSettings).toHaveBeenCalledWith(true, 49000);
    expect(screen.getByLabelText("Connection URL")).toHaveValue("http://127.0.0.1:49000/mcp");
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("keeps the URL preview marked as unsaved after a failed save", async () => {
    vi.mocked(setMcpSettings).mockRejectedValue("Port is already in use.");
    const close = vi.fn();
    render(<McpSettingsDialog onClose={close} />);
    await screen.findByLabelText("Port");
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Port is already in use.");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Connection URL")).toHaveValue("http://127.0.0.1:50000/mcp");
    expect(screen.getByText("Save settings to use this URL.")).toBeInTheDocument();
  });

  it("copies the token and closes with Escape without saving", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const close = vi.fn();
    render(<McpSettingsDialog onClose={close} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy access token" }));
    await screen.findByText("Access token copied.");
    expect(writeText).toHaveBeenCalledWith(saved.token);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(setMcpSettings).not.toHaveBeenCalled();
  });

  it("reports load errors and prevents saving incomplete settings", async () => {
    vi.mocked(getMcpSettings).mockRejectedValue("Settings unavailable.");
    render(<McpSettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Settings unavailable."));
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });

  it("traps keyboard focus and restores focus and scrolling on unmount", async () => {
    const { unmount } = render(<button>Open settings</button>);
    const opener = screen.getByRole("button", { name: "Open settings" });
    opener.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "scroll";
    const dialog = render(<McpSettingsDialog onClose={vi.fn()} />);
    try {
      const panel = screen.getByRole("dialog");
      expect(panel).toHaveFocus();
      expect(document.body.style.overflow).toBe("hidden");
      const first = await screen.findByRole("switch");
      const last = screen.getByRole("button", { name: "Save settings" });
      fireEvent.keyDown(panel, { key: "Tab" });
      expect(first).toHaveFocus();
      fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(first).toHaveFocus();
      panel.focus();
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
      dialog.unmount();
      expect(opener).toHaveFocus();
      expect(document.body.style.overflow).toBe("scroll");
    } finally {
      dialog.unmount();
      unmount();
      document.body.style.overflow = previousOverflow;
    }
  });

  it("blocks dismissal and repeated saves until the pending save finishes", async () => {
    let finish!: (value: typeof saved) => void;
    vi.mocked(setMcpSettings).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    render(<McpSettingsDialog onClose={close} />);
    await screen.findByLabelText("Port");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByLabelText("Port")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    fireEvent.click(saving);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    expect(setMcpSettings).toHaveBeenCalledTimes(1);
    await act(async () => finish(saved));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports clipboard and server errors while keeping the token available", async () => {
    vi.mocked(getMcpSettings).mockResolvedValue({ ...saved, error: "MCP is not running. Save settings to retry." });
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const close = vi.fn();
    render(<McpSettingsDialog onClose={close} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy access token" }));
    expect(await screen.findByText("Could not copy the access token. Select and copy it from the field.")).toBeInTheDocument();
    expect(screen.getByText("MCP is not running. Save settings to retry.")).toBeInTheDocument();
    expect(screen.getByLabelText("Access token")).toHaveValue(saved.token);
    fireEvent.click(screen.getByRole("dialog"));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["", "-1", "65536", "1.5"])("rejects invalid port %s", async (port) => {
    render(<McpSettingsDialog onClose={vi.fn()} />);
    const input = await screen.findByLabelText("Port");
    fireEvent.change(input, { target: { value: port } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose a whole number from 1 to 65535.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(screen.getByLabelText("Connection URL")).toHaveValue("");
    expect(setMcpSettings).not.toHaveBeenCalled();
  });

  it.each([1, 65535])("saves boundary port %s", async (port) => {
    vi.mocked(setMcpSettings).mockResolvedValue({ ...saved, port });
    const close = vi.fn();
    render(<McpSettingsDialog onClose={close} />);
    fireEvent.change(await screen.findByLabelText("Port"), { target: { value: String(port) } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(setMcpSettings).toHaveBeenCalledWith(false, port);
  });
});
