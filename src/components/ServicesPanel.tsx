import { TextAttributes } from "@opentui/core";
import { theme } from "#lib/theme";
import type { Service } from "#services/index";

interface ServicesPanelProps {
	focused: boolean;
	services: Service[];
	selectedServiceId: number;
	serviceSelectHeight: number;
	onServiceChange: (svc: Service) => void;
	onServiceSelect: (svc: Service) => void;
}

export function ServicesPanel({
	focused,
	services,
	selectedServiceId,
	serviceSelectHeight,
	onServiceChange,
	onServiceSelect,
}: ServicesPanelProps) {
	const serviceOptions = services.map((svc) => ({
		name: svc.name,
		description: "",
	}));

	return (
		<box
			flexDirection="column"
			border
			borderStyle={focused ? "double" : "rounded"}
			borderColor={focused ? theme.lavender : theme.surface2}
			padding={1}
			height={serviceSelectHeight + 4}
			title=" Services "
		>
			{services.length > 0 ? (
				<select
					options={serviceOptions}
					focused={focused}
					height={serviceSelectHeight}
					showDescription={false}
					focusedBackgroundColor="transparent"
					selectedBackgroundColor={theme.surface1}
					selectedTextColor={theme.yellow}
					textColor={theme.text}
					onChange={(index) => {
						const svc = services[index];
						if (svc) onServiceChange(svc);
					}}
					onSelect={(index) => {
						const svc = services[index];
						if (svc) onServiceSelect(svc);
					}}
				/>
			) : (
				<text fg={theme.overlay1}>Loading...</text>
			)}
			<box flexGrow={1} />
			<box marginTop={1}>
				<text fg={theme.subtext0} attributes={TextAttributes.ITALIC}>
					{services.find((s) => s.id === selectedServiceId)?.description ?? ""}
				</text>
			</box>
		</box>
	);
}
