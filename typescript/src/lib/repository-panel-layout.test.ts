import { describe, expect, test } from "bun:test";
import { SKILLS_LIST_MIN_WIDTH } from "#components/SkillsList";
import {
  assessRepositoryPanelWidths,
  REPOSITORY_LIST_MIN_WIDTH,
} from "./repository-panel-layout";

const repository = "kenbanks-peng/skills";

describe("repository panel layout", () => {
  test("meets each preference before sharing surplus equally", () => {
    const widths = assessRepositoryPanelWidths(110, [repository], ["short"]);

    expect(widths).toEqual({
      repository: 30,
      skills: 40,
      preview: 40,
      showPreview: true,
    });
  });

  test("allows for the repository select cursor without truncating the label", () => {
    const widths = assessRepositoryPanelWidths(98, [repository], ["short"]);

    expect(widths.repository).toBe(repository.length + 6);
    expect(widths.showPreview).toBe(true);
  });

  test("removes the preview when all preferred widths do not fit", () => {
    const widths = assessRepositoryPanelWidths(97, [repository], ["short"]);

    expect(widths).toEqual({
      repository: 44,
      skills: 53,
      preview: 0,
      showPreview: false,
    });
  });

  test("shares two-panel surplus equally after removing the preview", () => {
    const widths = assessRepositoryPanelWidths(
      110,
      ["acme/tools"],
      ["s".repeat(50)],
    );

    expect(widths).toEqual({
      repository: 34,
      skills: 76,
      preview: 0,
      showPreview: false,
    });
  });

  test("shares a shortage between the two required panels", () => {
    const widths = assessRepositoryPanelWidths(
      REPOSITORY_LIST_MIN_WIDTH + SKILLS_LIST_MIN_WIDTH,
      [repository],
      ["s".repeat(50)],
    );

    expect(widths).toEqual({
      repository: REPOSITORY_LIST_MIN_WIDTH,
      skills: SKILLS_LIST_MIN_WIDTH,
      preview: 0,
      showPreview: false,
    });
  });
});
