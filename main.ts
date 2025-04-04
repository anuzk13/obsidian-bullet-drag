import { Plugin } from 'obsidian';

interface DragState {
	initialX: number;
	initialY: number;
	dragging: boolean;
	sourceEl: HTMLElement;
	previewEl: HTMLElement | null;
}

const MAX_TEXT_LENGTH = 30;
function truncateText(text: string, maxLen = MAX_TEXT_LENGTH): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 3) + '...';
}

export default class CustomBulletDragPlugin extends Plugin {
	dragState: DragState | null = null;

	onload() {
		console.log("CustomBulletDragPlugin loaded.");

		// Register our event listeners in capture mode.
		document.addEventListener("mousedown", this.onMouseDown, true);
		document.addEventListener("mousemove", this.onMouseMove, true);
		document.addEventListener("mouseup", this.onMouseUp, true);

		// For hover: change the cursor to a hand if Alt is held down on a bullet line.
		document.body.addEventListener("mouseover", this.onMouseOverBullet, true);
		document.body.addEventListener("mouseout", this.onMouseOutBullet, true);
	}

	onunload() {
		console.log("CustomBulletDragPlugin unloaded.");
		document.removeEventListener("mousedown", this.onMouseDown, true);
		document.removeEventListener("mousemove", this.onMouseMove, true);
		document.removeEventListener("mouseup", this.onMouseUp, true);
		document.body.removeEventListener("mouseover", this.onMouseOverBullet, true);
		document.body.removeEventListener("mouseout", this.onMouseOutBullet, true);
	}

	/**
	 * On mouseover: if Alt is pressed and the hovered element is a bullet line,
	 * change its cursor to "grab."
	 */
	onMouseOverBullet = (e: MouseEvent) => {
		if (!e.altKey) return;
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line") as HTMLElement | null;
		if (bulletEl && bulletEl.textContent?.trim().startsWith("- ")) {
			bulletEl.style.cursor = "grab";
		}
	};

	/**
	 * On mouseout: reset the cursor style.
	 */
	onMouseOutBullet = (e: MouseEvent) => {
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line") as HTMLElement | null;
		if (bulletEl && bulletEl.textContent?.trim().startsWith("- ")) {
			bulletEl.style.cursor = "";
		}
	};

	/**
	 * On mousedown, require Alt to be pressed. If the click occurs on a bullet line,
	 * record the initial coordinates and source element.
	 */
	onMouseDown = (e: MouseEvent) => {
		if (!e.altKey) return; // Only initiate drag if Alt is held.
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line") as HTMLElement | null;
		if (bulletEl && bulletEl.textContent && bulletEl.textContent.trim().startsWith("- ")) {
			this.dragState = {
				initialX: e.clientX,
				initialY: e.clientY,
				dragging: false,
				sourceEl: bulletEl,
				previewEl: null,
			};
			console.log("Alt+mousedown on bullet:", bulletEl.textContent.trim());
			// Prevent further processing (like text editing) for this event.
			e.preventDefault();
			e.stopPropagation();
		}
	};

	/**
	 * On mousemove, if a drag has been initiated, check if the pointer has moved enough
	 * to start dragging. Once dragging starts, create a floating "pill" that follows the mouse.
	 */
	onMouseMove = (e: MouseEvent) => {
		if (!this.dragState) return;

		const dx = e.clientX - this.dragState.initialX;
		const dy = e.clientY - this.dragState.initialY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const DRAG_THRESHOLD = 5; // pixels

		if (!this.dragState.dragging && distance > DRAG_THRESHOLD) {
			this.dragState.dragging = true;
			// Change the source bullet's cursor to "grabbing."
			this.dragState.sourceEl.style.cursor = "grabbing";

			// Create a floating preview "pill" element.
			const preview = document.createElement("div");
			preview.style.position = "fixed";
			preview.style.top = e.clientY + "px";
			preview.style.left = e.clientX + "px";
			preview.style.zIndex = "10000";
			preview.style.pointerEvents = "none";
			// Style as a pill.
			preview.style.display = "inline-flex";
			preview.style.alignItems = "center";
			preview.style.borderRadius = "16px";
			preview.style.backgroundColor = "var(--background-secondary, rgba(0,0,0,0.1))";
			preview.style.color = "var(--text-normal, #000)";
			preview.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.2)";
			preview.style.padding = "4px 8px";
			preview.style.fontSize = "0.9em";
			preview.style.maxWidth = "200px";
			preview.style.overflow = "hidden";
			preview.style.textOverflow = "ellipsis";
			preview.style.whiteSpace = "nowrap";

			// Create an icon element for the bullet (replace "•" with your preferred icon).
			const iconSpan = document.createElement("span");
			iconSpan.textContent = "•";
			iconSpan.style.marginRight = "6px";
			preview.appendChild(iconSpan);

			// Add the bullet text (truncated and without the initial dash).
			const bulletText = this.dragState.sourceEl.textContent?.trim().replace(/^-\s*/, "") || "";
			const textSpan = document.createElement("span");
			textSpan.textContent = truncateText(bulletText);
			preview.appendChild(textSpan);

			document.body.appendChild(preview);
			this.dragState.previewEl = preview;

			console.log("Dragging started for bullet:", bulletText);
		}

		if (this.dragState.dragging && this.dragState.previewEl) {
			// Update the position of the preview pill.
			this.dragState.previewEl.style.top = e.clientY + 10 + "px";
			this.dragState.previewEl.style.left = e.clientX + 10 + "px";
			e.preventDefault();
		}
	};

	/**
	 * On mouseup, if dragging was active, remove the preview and log the drop.
	 * Reset the source element's cursor style.
	 */
	onMouseUp = (e: MouseEvent) => {
		if (!this.dragState) return;

		const wasDragging = this.dragState.dragging;
		const bulletText = this.dragState.sourceEl.textContent?.trim() || "";
		if (wasDragging) {
			console.log("Dropped bullet:", bulletText);
			if (this.dragState.previewEl) {
				document.body.removeChild(this.dragState.previewEl);
			}
		} else {
			console.log("Mouse up without dragging on bullet:", bulletText);
		}
		// Reset the cursor on the source element.
		this.dragState.sourceEl.style.cursor = "";
		this.dragState = null;
	};
}
