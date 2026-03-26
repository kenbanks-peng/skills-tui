import { theme } from "./theme";
import { ServiceId } from "./services";

interface FooterProps {
	focusedColumn: string;
	selectedServiceId: ServiceId;
}

export function Footer({ focusedColumn, selectedServiceId }: FooterProps) {
	return (
		<box
			paddingLeft={1}
			paddingRight={1}
			borderStyle="single"
			borderColor={theme.surface1}
			flexDirection="row"
			alignItems="center"
			justifyContent="space-between"
		>
			<box flexDirection="column">
				<ascii-font font="tiny" text="Skills" color={theme.mauve} />
				<text>
					<span fg={theme.green}>{"   \u23bc\u23bc\u22b0"}</span>
					<span fg={theme.red}>{"\u2985@"}</span>
				</text>
			</box>
			<text fg={theme.subtext0}>
				<span fg={theme.sapphire}>Navigate: </span>
				<span fg={theme.overlay1}>Tab/Arrows</span>
				{focusedColumn === "content2" &&
				selectedServiceId === ServiceId.VIEW_BY_REPO ? (
					<>
						<span fg={theme.sapphire}>{"   "}Jump: </span>
						<span fg={theme.overlay1}>PgUp/PgDn</span>
						<span fg={theme.sapphire}>{"   "}Toggle: </span>
						<span fg={theme.overlay1}>Space</span>
						<span fg={theme.sapphire}>{"   "}Install: </span>
						<span fg={theme.overlay1}>Enter</span>
					</>
				) : (
					<>
						<span fg={theme.sapphire}>{"   "}Select: </span>
						<span fg={theme.overlay1}>Enter</span>
						<span fg={theme.sapphire}>{"   "}Toggle: </span>
						<span fg={theme.overlay1}>Space</span>
					</>
				)}
				<span fg={theme.sapphire}>{"   "}Quit: </span>
				<span fg={theme.overlay1}>Esc</span>
			</text>
		</box>
	);
}
