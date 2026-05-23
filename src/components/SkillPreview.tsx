import { TextAttributes } from "@opentui/core";
import { theme } from "#lib/theme";
import { truncateText } from "#lib/utils";

interface SkillPreviewProps {
	skillName: string | null;
	path: string | null;
	content: string | null;
	loading: boolean;
}

function firstParagraph(content: string): string {
	const lines = content.split("\n");
	const paragraph: string[] = [];
	let pastTitle = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (paragraph.length > 0) break;
			continue;
		}
		if (!pastTitle && trimmed.startsWith("#")) {
			pastTitle = true;
			continue;
		}
		if (trimmed.startsWith("```")) continue;
		paragraph.push(trimmed);
	}

	return paragraph.join(" ");
}

function sectionSnippet(content: string, heading: string): string | null {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => {
		const trimmed = line.trim().toLowerCase();
		return trimmed.startsWith("#") && trimmed.includes(heading);
	});
	if (start === -1) return null;

	const snippet: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) break;
		if (!trimmed) continue;
		snippet.push(trimmed.replace(/^-\s*/, ""));
		if (snippet.length === 3) break;
	}

	return snippet.length > 0 ? snippet.join(" ") : null;
}

export function SkillPreview({
	skillName,
	path,
	content,
	loading,
}: SkillPreviewProps) {
	const summary = content ? firstParagraph(content) : null;
	const whenToUse = content ? sectionSnippet(content, "when to use") : null;

	return (
		<box
			flexDirection="column"
			width={38}
			flexGrow={1}
			border
			borderStyle="rounded"
			borderColor={theme.surface2}
			padding={1}
			overflow="hidden"
			title=" Preview "
		>
			{!skillName ? (
				<text fg={theme.overlay1}>Select a skill to preview</text>
			) : loading ? (
				<text fg={theme.overlay1}>Loading preview...</text>
			) : content ? (
				<box flexDirection="column" gap={1} overflow="hidden">
					<text fg={theme.yellow} attributes={TextAttributes.BOLD}>
						{truncateText(skillName, 34)}
					</text>
					{path && <text fg={theme.overlay1}>{truncateText(path, 34)}</text>}
					{summary && (
						<box flexDirection="column">
							<text fg={theme.lavender}>Summary</text>
							<text fg={theme.text}>{truncateText(summary, 180)}</text>
						</box>
					)}
					{whenToUse && (
						<box flexDirection="column">
							<text fg={theme.lavender}>When to use</text>
							<text fg={theme.subtext1}>{truncateText(whenToUse, 180)}</text>
						</box>
					)}
				</box>
			) : (
				<box flexDirection="column" gap={1}>
					<text fg={theme.yellow} attributes={TextAttributes.BOLD}>
						{truncateText(skillName, 34)}
					</text>
					<text fg={theme.overlay1}>No SKILL.md preview available</text>
				</box>
			)}
		</box>
	);
}
