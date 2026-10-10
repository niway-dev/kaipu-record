import { describe, expect, it, vi } from "vitest";
import { makeBeforeDeleteUser } from "./account-deletion";

describe("makeBeforeDeleteUser", () => {
  it("enqueues the purge for the user being deleted", async () => {
    const enqueue = vi.fn(async (_userId: string) => {});
    await makeBeforeDeleteUser({ enqueue })({ id: "user-1" });
    expect(enqueue).toHaveBeenCalledWith("user-1");
  });

  it("propagates an enqueue failure so Better Auth does not delete the user", async () => {
    const err = new Error("db unavailable");
    const enqueue = vi.fn(async () => {
      throw err;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(makeBeforeDeleteUser({ enqueue })({ id: "user-1" })).rejects.toBe(err);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("account deletion refused"),
      expect.objectContaining({ userId: "user-1", error: "Error" }),
    );
    spy.mockRestore();
  });

  it("enqueues before the delete runs (Better Auth calls beforeDelete, then deleteUser)", async () => {
    const order: string[] = [];
    const beforeDelete = makeBeforeDeleteUser({
      enqueue: async () => {
        order.push("enqueue");
      },
    });
    // Mirrors better-auth's delete-user route: `await beforeDelete(user); await deleteUser(id)`.
    await beforeDelete({ id: "u" });
    order.push("delete");
    expect(order).toEqual(["enqueue", "delete"]);
  });
});
