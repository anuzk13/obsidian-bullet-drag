import { Plugin, WorkspaceLeaf, TFile } from "obsidian";

interface DragState {
	initialX: number;
	initialY: number;
	dragging: boolean;
	/** The element used as the drag source */
	sourceEl: HTMLElement;
	previewEl: HTMLElement | null;
}

const MAX_TEXT_LENGTH = 30;
function truncateText(text: string, maxLen = MAX_TEXT_LENGTH): string {
	return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}

export default class CustomBulletDragPlugin extends Plugin {
	dragState: DragState | null = null;

	onload() {
		console.log("CustomBulletDragPlugin loaded.");

		document.addEventListener("mousedown", this.onMouseDown, true);
		document.addEventListener("mousemove", this.onMouseMove, true);
		document.addEventListener("mouseup", this.onMouseUp, true);

		document.body.addEventListener("mouseover", this.onMouseOverBullet, true);
		document.body.addEventListener("mouseout", this.onMouseOutBullet, true);

		window.addEventListener("error", this.globalErrorHandler, true);
	}

	onunload() {
		console.log("CustomBulletDragPlugin unloaded.");
		document.removeEventListener("mousedown", this.onMouseDown, true);
		document.removeEventListener("mousemove", this.onMouseMove, true);
		document.removeEventListener("mouseup", this.onMouseUp, true);
		document.body.removeEventListener("mouseover", this.onMouseOverBullet, true);
		document.body.removeEventListener("mouseout", this.onMouseOutBullet, true);
		window.removeEventListener("error", this.globalErrorHandler, true);
	}

	globalErrorHandler = (event: ErrorEvent): boolean => {
		if (event.message && event.message.includes("ResizeObserver loop completed with undelivered notifications")) {
			event.stopImmediatePropagation();
			return false;
		}
		return true;
	};

	onMouseOverBullet = (e: MouseEvent) => {
		if (!e.altKey) return;
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line");
		if (bulletEl) {
			// Remove any zero-width spaces before checking
			const text = bulletEl.textContent?.replace(/\u200B/g, '').trim();
			if (text && text.startsWith("-")) {
				(bulletEl as HTMLElement).style.cursor = "grab";
			}
		}
	};

	onMouseOutBullet = (e: MouseEvent) => {
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line");
		if (bulletEl && bulletEl.textContent?.trim().startsWith("-")) {
			(bulletEl as HTMLElement).style.cursor = "";
		}
	};

	onMouseDown = (e: MouseEvent) => {
		if (!e.altKey) return;
		const bulletLine = (e.target as HTMLElement).closest(".cm-line") as HTMLElement | null;
		if (bulletLine) {
			// Remove zero-width spaces before verifying the bullet text
			const text = bulletLine.textContent?.replace(/\u200B/g, '').trim();
			if (text && text.startsWith("-")) {
				const candidate = bulletLine.querySelector("span[class^='cm-list-']:not(.cm-formatting)") as HTMLElement | null;
				const dragSource = candidate || bulletLine;
				dragSource.style.userSelect = "none";
				this.dragState = {
					initialX: e.clientX,
					initialY: e.clientY,
					dragging: false,
					sourceEl: dragSource,
					previewEl: null,
				};
				console.log("Alt+mousedown on bullet:", text);
				e.preventDefault();
				e.stopPropagation();
			}
		}
	};
	

	onMouseMove = (e: MouseEvent) => {
		if (!this.dragState) return;
		const dx = e.clientX - this.dragState.initialX;
		const dy = e.clientY - this.dragState.initialY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const DRAG_THRESHOLD = 5;
		if (!this.dragState.dragging && distance > DRAG_THRESHOLD) {
			this.dragState.dragging = true;
			this.dragState.sourceEl.style.cursor = "grabbing";
			const preview = document.createElement("div");
			preview.style.position = "fixed";
			preview.style.top = e.clientY + "px";
			preview.style.left = e.clientX + "px";
			preview.style.zIndex = "10000";
			preview.style.pointerEvents = "none";
			preview.style.display = "inline-flex";
			preview.style.alignItems = "center";
			preview.style.borderRadius = "16px";
			preview.style.backgroundColor = "var(--background-secondary, rgba(0,0,0,0.1))";
			preview.style.color = "var(--text-normal, #000)";
			preview.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
			preview.style.padding = "4px 8px";
			preview.style.fontSize = "0.9em";
			preview.style.maxWidth = "200px";
			preview.style.overflow = "hidden";
			preview.style.textOverflow = "ellipsis";
			preview.style.whiteSpace = "nowrap";
			const iconSpan = document.createElement("span");
			iconSpan.textContent = "•";
			iconSpan.style.marginRight = "6px";
			preview.appendChild(iconSpan);
			// Retrieve the full bullet line from the source element.
			const bulletLine = this.dragState.sourceEl.closest(".cm-line") as HTMLElement;
			const bulletTextRaw = bulletLine.textContent?.trim() || "";
			const bulletText = bulletTextRaw.replace(/^-\s*/, "");
			const textSpan = document.createElement("span");
			textSpan.textContent = truncateText(bulletText);
			preview.appendChild(textSpan);
			document.body.appendChild(preview);
			this.dragState.previewEl = preview;
			console.log("Dragging started for bullet:", bulletText);
		}
		if (this.dragState.dragging && this.dragState.previewEl) {
			this.dragState.previewEl.style.top = e.clientY + 10 + "px";
			this.dragState.previewEl.style.left = e.clientX + 10 + "px";
			e.preventDefault();
		}
	};

	onMouseUp = async (e: MouseEvent) => {
		if (!this.dragState) return;
		const wasDragging = this.dragState.dragging;
		const bulletLine = this.dragState.sourceEl.closest(".cm-line") as HTMLElement;
		const bulletTextRaw = bulletLine?.textContent?.trim() || "";
		const bulletText = bulletTextRaw.replace(/^-\s*/, "");
		if (wasDragging) {
			console.log("Dropped bullet:", bulletText);
			if (this.dragState.previewEl) {
				document.body.removeChild(this.dragState.previewEl);
			}
			const file = this.app.workspace.getActiveFile();
			if (file && file.extension === "md") {
				let id = "";
				if (bulletTextRaw.indexOf("^") !== -1) {
					id = bulletTextRaw.slice(bulletTextRaw.indexOf("^") + 1).trim();
				} else {
					id = this.generateBulletId();
					console.log("Generated new bullet id:", id);
					await this.updateBulletInFile(bulletTextRaw, id, file);
				}
				const fileNameNoExt = file.name.replace(/\.md$/, "");
				// Link format: ![[FileName#^id]]
				const linkReference = `![[${fileNameNoExt}#^${id}]]`;
				console.log("Creating canvas node with link:", linkReference, "at", e.clientX, e.clientY);
				this.addCanvasNode(linkReference, e.clientX, e.clientY);
			} else {
				console.log("No valid markdown file active.");
			}
		} else {
			console.log("Mouse up without dragging on bullet:", bulletText);
		}
		this.dragState.sourceEl.style.userSelect = "";
		bulletLine.style.cursor = "";
		this.dragState = null;
	};

	async updateBulletInFile(bulletTextRaw: string, id: string, file: TFile): Promise<void> {
		// Remove zero-width spaces.
		const sanitizedText = bulletTextRaw.replace(/\u200B/g, '');
		// Remove the bullet marker and trim to get the main text.
		const mainBulletText = sanitizedText.replace(/^-\s*/, "").trim();
		// Use the first 50 characters as a snippet to find the corresponding line in the file.
		const snippet = mainBulletText.slice(0, 50);
		// Read the file content.
		const content = await this.app.vault.read(file);
		// Build a regex that matches a bullet line that contains the snippet and does not already have an id.
		// This regex captures the entire line (group 1) and any trailing whitespace (group 2).
		const regex = new RegExp(`^(\\s*-.*${this.escapeRegex(snippet)}.*?)(?!\\s*\\^)(\\s*)$`, "m");
		// Append the id at the very end of the line.
		const replacement = `$1 ^${id}$2`;
		const newContent = content.replace(regex, replacement);
		if (newContent !== content) {
			await this.app.vault.modify(file, newContent);
			console.log("Updated bullet in file with id:", id);
		} else {
			console.log("Bullet line was not updated; it may already have an id.");
		}
	}
	

	escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	generateBulletId(): string {
		return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
	}

	/**
	 * Creates a canvas node with its text set to the linkReference using the createTextNode API.
	 */
	addCanvasNode(linkReference: string, x: number, y: number) {
		const canvasLeaves = this.app.workspace.getLeavesOfType("canvas");
		const canvasLeaf = canvasLeaves.find((leaf: WorkspaceLeaf) => {
			const canvasView = leaf.view as any;
			if (canvasView && canvasView.getViewType && canvasView.getViewType() === "canvas") {
				const rect = canvasView.containerEl.getBoundingClientRect();
				return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
			}
			return false;
		});
		if (canvasLeaf) {
			const canvasView = canvasLeaf.view as any;
			if (typeof canvasView.canvas.createTextNode === "function") {
				canvasView.canvas.createTextNode({
					pos: { x, y },
					text: linkReference,
					save: true,
					focus: true,
				});
				console.log("Node added to canvas.");
			} else {
				console.error("createTextNode API is not available on canvas.");
			}
		} else {
			console.log("No canvas found under drop coordinates.");
		}
	}
}
