import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ErrorState", () => {
  it("renders message and retry button when onRetry provided", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Something went wrong" onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong");
    const button = screen.getByRole("button", { name: "common:retry" });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render button when onRetry not provided", () => {
    render(<ErrorState message="Error" />);
    expect(screen.getByRole("alert").textContent).toContain("Error");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
