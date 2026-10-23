import { searchUsers } from "@/lib/actions/friends";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "./factories";
import { asUser } from "./setup";

let meId: string;

beforeEach(async () => {
  meId = (await createUser({ name: "Me" })).id;
  await createUser({ name: "Alice Hansen", email: "alice@example.com" });
  await createUser({ name: "Bob Berg", email: "bob@example.com" });
  asUser(meId);
});

async function search(query: string) {
  const result = await searchUsers({ query });
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe("searchUsers", () => {
  it("never returns another user's email", async () => {
    const results = await search("Alice");
    expect(results.map((r) => r.name)).toEqual(["Alice Hansen"]);
    expect(results[0]).not.toHaveProperty("email");
  });

  it("does not list users for short queries", async () => {
    expect(await search("a")).toEqual([]);
    expect(await search("al")).toEqual([]);
  });

  it("treats LIKE wildcards as plain characters", async () => {
    expect(await search("___")).toEqual([]);
    expect(await search("%%%")).toEqual([]);
  });

  it("does not match a partial email", async () => {
    expect(await search("example.com")).toEqual([]);
    expect(await search("@example")).toEqual([]);
  });

  it("finds a user by their exact email, ignoring case", async () => {
    expect((await search("Bob@Example.com")).map((r) => r.name)).toEqual(["Bob Berg"]);
  });
});
