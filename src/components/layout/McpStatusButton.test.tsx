import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpSettings } from "../../lib/api";
import { McpStatusButton } from "./McpStatusButton";

vi.mock("../../lib/api", () => ({ getMcpSettings: vi.fn() }));
const settings = { enabled: false, running: false, port: 47831, token: "token", error: null };

describe("MCP footer status", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it.each([
    [settings, "disabled"],
    [{ ...settings, enabled: true, running: true }, "running"],
    [{ ...settings, enabled: true }, "error"],
  ] as const)("renders the server state and opens settings", async (value, status) => {
    vi.mocked(getMcpSettings).mockResolvedValue(value);
    const open = vi.fn();
    render(<McpStatusButton onClick={open} revision={0} />);
    const button = await screen.findByRole("button", { name: `MCP: ${status}. Open settings` });
    expect(button.querySelector(`.mcp-status-dot-${status}`)).not.toBeNull();
    fireEvent.click(button);
    expect(open).toHaveBeenCalledOnce();
  });

  it("refreshes after settings are saved and polls for unexpected stops", async () => {
    vi.useFakeTimers();
    vi.mocked(getMcpSettings).mockResolvedValue(settings);
    const { rerender, unmount } = render(<McpStatusButton onClick={vi.fn()} revision={0} />);
    await act(async () => {});
    vi.mocked(getMcpSettings).mockResolvedValue({ ...settings, enabled: true, running: true });
    rerender(<McpStatusButton onClick={vi.fn()} revision={1} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "MCP: running. Open settings" })).toBeInTheDocument();
    vi.mocked(getMcpSettings).mockRejectedValue("unavailable");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole("button", { name: "MCP: error. Open settings" })).toBeInTheDocument();
    unmount();
    const calls = vi.mocked(getMcpSettings).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getMcpSettings).toHaveBeenCalledTimes(calls);
  });
});
