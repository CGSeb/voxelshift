import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
