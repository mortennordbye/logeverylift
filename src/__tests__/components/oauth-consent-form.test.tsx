// @vitest-environment jsdom
import { OAuthConsentForm } from "@/components/features/OAuthConsentForm";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.fn();
vi.mock("@/lib/auth-client", () => ({ authClient: { oauth2: { consent: (body: unknown) => consent(body) } } }));

const REQUESTED = ["openid", "offline_access", "mcp:read", "mcp:write"];

beforeEach(() => {
  consent.mockReset();
  consent.mockResolvedValue({ data: {}, error: null });
});

/** The consent page sends the request narrowed to the access the user picked (docs/plans/mcp-access.md, 2.1). */
describe("OAuthConsentForm", () => {
  it("preselects read only and sends the request without mcp:write", async () => {
    render(<OAuthConsentForm requestedScopes={REQUESTED} canRead canWrite />);
    expect(screen.getByRole("radio", { name: /Read only/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(consent).toHaveBeenCalledWith({ accept: true, scope: "openid offline_access mcp:read" }));
  });

  it("sends the full request for read and change", async () => {
    render(<OAuthConsentForm requestedScopes={REQUESTED} canRead canWrite />);
    fireEvent.click(screen.getByRole("radio", { name: /Read and change/ }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() =>
      expect(consent).toHaveBeenCalledWith({ accept: true, scope: "openid offline_access mcp:read mcp:write" }),
    );
  });

  it("offers only read only when the client did not ask for mcp:write", () => {
    render(<OAuthConsentForm requestedScopes={["mcp:read"]} canRead canWrite={false} />);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.queryByRole("radio", { name: /Read and change/ })).toBeNull();
  });

  it("denies without a scope", async () => {
    render(<OAuthConsentForm requestedScopes={REQUESTED} canRead canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(consent).toHaveBeenCalledWith({ accept: false }));
  });

  it("says so when the client asked for no LogEveryLift access", async () => {
    render(<OAuthConsentForm requestedScopes={["openid"]} canRead={false} canWrite={false} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/did not ask for access/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(consent).toHaveBeenCalledWith({ accept: true }));
  });
});
