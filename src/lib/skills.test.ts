import { describe, expect, test } from "bun:test";
import { reconcileRepoSkillNames } from "./skills";

describe("repository cache reconciliation", () => {
  test("removes cached skills that are absent from the source and not installed", () => {
    expect(
      reconcileRepoSkillNames(
        ["deleted", "kept", "installed-deleted"],
        ["kept", "new"],
        new Set(["installed-deleted"]),
      ),
    ).toEqual({
      skills: ["installed-deleted", "kept", "new"],
      removed: ["deleted"],
    });
  });

  test("deduplicates and sorts reconciled skill names", () => {
    expect(
      reconcileRepoSkillNames(
        ["zebra", "alpha", "alpha"],
        ["beta", "alpha", "beta"],
        new Set(["zebra"]),
      ),
    ).toEqual({
      skills: ["alpha", "beta", "zebra"],
      removed: [],
    });
  });
});
