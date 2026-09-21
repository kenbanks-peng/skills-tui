import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { Footer } from "./Footer";
import { SearchFilter } from "./SearchFilter";
import { SkillsList } from "./SkillsList";
import { ServiceId } from "#services/index";

async function captureList(
  height: number,
  scrollOffset: number,
  count: number,
) {
  const totalVH = Math.max(5, height - 15);
  const setup = await testRender(
    <box flexDirection="column" flexGrow={1}>
      <box paddingTop={1} />
      <box
        flexDirection="row"
        flexGrow={1}
        paddingTop={1}
        paddingBottom={1}
        paddingRight={1}
      >
        <box flexDirection="column" flexGrow={1}>
          <box flexDirection="row" flexGrow={1}>
            <SkillsList
              width={50}
              focusedColumn="skills"
              filteredSkills={Array.from(
                { length: count },
                (_, i) => `skill-${i}`,
              )}
              selectedSkills={new Set()}
              loadingSkills={false}
              searchFilter=""
              scrollOffset={scrollOffset}
              activeIndex={scrollOffset}
              adjustedVH={totalVH - (scrollOffset > 0 ? 2 : 1)}
            />
          </box>
          <SearchFilter focused={false} searchFilter="" />
        </box>
      </box>
      <Footer
        focusedColumn="content2"
        selectedServiceId={ServiceId.VIEW_BY_REPO}
      />
    </box>,
    { width: 140, height },
  );
  try {
    await setup.renderOnce();
    return setup.captureCharFrame().split("\n");
  } finally {
    await act(async () => setup.renderer.destroy());
  }
}

for (const height of [24, 40]) {
  test(`scroll indicators keep the hotkey menu centered at height ${height}`, async () => {
    const initial = await captureList(height, 0, 100);
    const middle = await captureList(height, 10, 100);
    const end = await captureList(height, 99, 100);
    const menuRow = (lines: string[]) =>
      lines.findIndex((line) => line.includes("Navigate:"));
    expect(menuRow(initial)).toBeGreaterThan(0);
    expect(menuRow(middle)).toBe(menuRow(initial));
    expect(menuRow(end)).toBe(menuRow(initial));
  });
}

test("more above is immediately followed by the first visible skill", async () => {
  const lines = await captureList(40, 10, 100);
  const indicatorRow = lines.findIndex((line) => line.includes("more above"));
  expect(indicatorRow).toBeGreaterThan(0);
  expect(lines[indicatorRow + 1]).toContain("skill-10");
});
