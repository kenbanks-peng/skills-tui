import { useCallback, useEffect, useState } from "react";

interface ScrollableListResult {
	index: number;
	scrollOffset: number;
	setIndex: (i: number) => void;
	reset: () => void;
	handlers: Record<string, () => void>;
}

export function useScrollableList(
	itemCount: number,
	viewportHeight: number,
): ScrollableListResult {
	const [index, setIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);

	const reset = useCallback(() => {
		setIndex(0);
		setScrollOffset(0);
	}, []);

	// Clamp index if itemCount shrinks
	useEffect(() => {
		if (index >= itemCount && itemCount > 0) {
			setIndex(itemCount - 1);
			setScrollOffset(Math.max(0, itemCount - viewportHeight));
		}
	}, [itemCount, index, viewportHeight]);

	const handlers: Record<string, () => void> = {
		up: () => {
			const newIndex = Math.max(0, index - 1);
			if (newIndex < scrollOffset) setScrollOffset(newIndex);
			setIndex(newIndex);
		},
		down: () => {
			const newIndex = Math.min(itemCount - 1, index + 1);
			if (newIndex >= scrollOffset + viewportHeight) {
				setScrollOffset(newIndex - viewportHeight + 1);
			}
			setIndex(newIndex);
		},
		pageup: () => {
			const newIndex = Math.max(0, index - viewportHeight);
			setScrollOffset(Math.max(0, newIndex));
			setIndex(newIndex);
		},
		pagedown: () => {
			const newIndex = Math.min(itemCount - 1, index + viewportHeight);
			const maxOffset = Math.max(0, itemCount - viewportHeight);
			setScrollOffset(Math.min(maxOffset, newIndex));
			setIndex(newIndex);
		},
		home: () => {
			setIndex(0);
			setScrollOffset(0);
		},
		end: () => {
			const lastIndex = Math.max(0, itemCount - 1);
			setIndex(lastIndex);
			setScrollOffset(Math.max(0, itemCount - viewportHeight));
		},
	};

	return { index, scrollOffset, setIndex, reset, handlers };
}
