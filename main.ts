import { Plugin } from 'obsidian';

interface DragState {
	initialX: number;
	initialY: number;
	dragging: boolean;
	sourceEl: HTMLElement;
	previewEl: HTMLElement | null;
}

export default class CustomBulletDragPlugin extends Plugin {
	dragState: DragState | null = null;

	onload() {
		console.log("CustomBulletDragPlugin loaded.");

		// Attach our mouse event listeners in capture mode.
		document.addEventListener("mousedown", this.onMouseDown, true);
		document.addEventListener("mousemove", this.onMouseMove, true);
		document.addEventListener("mouseup", this.onMouseUp, true);
	}

	onunload() {
		console.log("CustomBulletDragPlugin unloaded.");
		document.removeEventListener("mousedown", this.onMouseDown, true);
		document.removeEventListener("mousemove", this.onMouseMove, true);
		document.removeEventListener("mouseup", this.onMouseUp, true);
	}

	/**
	 * On mousedown, if the user holds Alt, and the click is on a bullet line (a .cm-line element
	 * whose text starts with "- "), we record the initial state.
	 */
	onMouseDown = (e: MouseEvent) => {
		// Only trigger our custom drag if Alt is held down.
		if (!e.altKey) return;

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
		}
	};

	/**
	 * On mousemove, if a drag has been initiated (distance > threshold), we create a floating preview
	 * and update its position. We call preventDefault to help block interference with text editing.
	 */
	onMouseMove = (e: MouseEvent) => {
		if (!this.dragState) return;

		const dx = e.clientX - this.dragState.initialX;
		const dy = e.clientY - this.dragState.initialY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const DRAG_THRESHOLD = 5; // pixels

		if (!this.dragState.dragging && distance > DRAG_THRESHOLD) {
			this.dragState.dragging = true;
			// Create a preview element to follow the mouse.
			const preview = document.createElement("div");
			preview.style.position = "fixed";
			preview.style.top = e.clientY + "px";
			preview.style.left = e.clientX + "px";
			preview.style.backgroundColor = "rgba(0, 0, 0, 0.1)";
			preview.style.border = "1px dashed #000";
			preview.style.padding = "2px 4px";
			preview.style.pointerEvents = "none";
			preview.style.zIndex = "10000";
			preview.textContent = this.dragState.sourceEl.textContent?.trim() || "";
			document.body.appendChild(preview);
			this.dragState.previewEl = preview;
			// Prevent further default behavior.
			e.preventDefault();
			console.log("Dragging started for bullet:", this.dragState.sourceEl.textContent?.trim());
		}

		if (this.dragState.dragging && this.dragState.previewEl) {
			// Update preview element position.
			this.dragState.previewEl.style.top = e.clientY + 10 + "px";
			this.dragState.previewEl.style.left = e.clientX + 10 + "px";
			e.preventDefault();
		}
	};

	/**
	 * On mouseup, if we were dragging, we remove the preview and log the drop.
	 */
	onMouseUp = (e: MouseEvent) => {
		if (!this.dragState) return;
		if (this.dragState.dragging) {
			console.log("Dropped bullet:", this.dragState.sourceEl.textContent?.trim());
			if (this.dragState.previewEl) {
				document.body.removeChild(this.dragState.previewEl);
			}
		} else {
			console.log("Mouse up without dragging on bullet:", this.dragState.sourceEl.textContent?.trim());
		}
		this.dragState = null;
	};
}
