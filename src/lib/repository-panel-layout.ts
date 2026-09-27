import { SKILL_PREVIEW_MIN_WIDTH } from "#components/SkillPreview";
import { SKILLS_LIST_MIN_WIDTH } from "#components/SkillsList";

export const REPOSITORY_LIST_MIN_WIDTH = 14;

interface RepositoryPanelWidths {
  repository: number;
  skills: number;
  preview: number;
  showPreview: boolean;
}

function longestLineWidth(values: string[]): number {
  return values.reduce((longest, value) => Math.max(longest, value.length), 0);
}

function distributeSurplus(
  preferred: number[],
  availableWidth: number,
): number[] {
  const surplus =
    availableWidth - preferred.reduce((sum, width) => sum + width, 0);
  const shared = Math.floor(surplus / preferred.length);
  let remainder = surplus % preferred.length;

  return preferred.map((width) => {
    const remainderShare = remainder > 0 ? 1 : 0;
    remainder -= remainderShare;
    return width + shared + remainderShare;
  });
}

function fitListsToAvailableWidth(
  availableWidth: number,
  repositoryPreferred: number,
  skillsPreferred: number,
): [number, number] {
  if (availableWidth >= repositoryPreferred + skillsPreferred) {
    const [repository, skills] = distributeSurplus(
      [repositoryPreferred, skillsPreferred],
      availableWidth,
    );
    return [repository, skills];
  }

  const minimumWidth = REPOSITORY_LIST_MIN_WIDTH + SKILLS_LIST_MIN_WIDTH;
  const remaining = Math.max(0, availableWidth - minimumWidth);
  const repositoryDeficit = Math.max(
    0,
    repositoryPreferred - REPOSITORY_LIST_MIN_WIDTH,
  );
  const skillsDeficit = Math.max(0, skillsPreferred - SKILLS_LIST_MIN_WIDTH);
  const totalDeficit = repositoryDeficit + skillsDeficit;
  const repositoryExtra =
    totalDeficit === 0
      ? 0
      : Math.min(
          repositoryDeficit,
          Math.round((remaining * repositoryDeficit) / totalDeficit),
        );

  return [
    REPOSITORY_LIST_MIN_WIDTH + repositoryExtra,
    SKILLS_LIST_MIN_WIDTH + remaining - repositoryExtra,
  ];
}

export function assessRepositoryPanelWidths(
  contentWidth: number,
  repositoryLabels: string[],
  skillNames: string[],
): RepositoryPanelWidths {
  // Repository rows also reserve room for the select cursor.
  const repositoryPreferred = Math.max(
    REPOSITORY_LIST_MIN_WIDTH,
    longestLineWidth(repositoryLabels) + 6,
  );
  // Skill rows use panel padding, row padding, and a checkbox prefix.
  const skillsPreferred = Math.max(
    SKILLS_LIST_MIN_WIDTH,
    longestLineWidth(skillNames) + 9,
  );
  const previewPreferred = SKILL_PREVIEW_MIN_WIDTH;
  const allPreferredWidth =
    repositoryPreferred + skillsPreferred + previewPreferred;

  if (contentWidth >= allPreferredWidth) {
    const [repository, skills, preview] = distributeSurplus(
      [repositoryPreferred, skillsPreferred, previewPreferred],
      contentWidth,
    );
    return { repository, skills, preview, showPreview: true };
  }

  const [repository, skills] = fitListsToAvailableWidth(
    contentWidth,
    repositoryPreferred,
    skillsPreferred,
  );
  return { repository, skills, preview: 0, showPreview: false };
}
