import { Logger } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";

describe("AnalyticsService.emit", () => {
  const make = (create: jest.Mock) => new AnalyticsService({ analyticsEvent: { create } } as any);

  it("writes the event", async () => {
    const create = jest.fn().mockResolvedValue({});
    await make(create).emit("chat_turn_completed", { a: 1 }, "s1");
    expect(create).toHaveBeenCalledWith({ data: { eventName: "chat_turn_completed", payload: { a: 1 }, sessionId: "s1" } });
  });

  it("never rejects when the insert fails — logs and resolves", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const create = jest.fn().mockRejectedValue(new Error("remaining connection slots are reserved"));
    await expect(make(create).emit("chat_turn_completed", {}, "s1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("chat_turn_completed"));
    warn.mockRestore();
  });

  it("swallows a synchronous throw from the client too", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const create = jest.fn(() => {
      throw new Error("client not connected");
    });
    await expect(make(create as any).emit("x")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
