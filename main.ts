import { Plugin, WorkspaceLeaf, MarkdownView, Editor } from "obsidian";
import { CanvasView } from "obsidian-canvas";

// Interface defining the state during a drag operation
interface DragState {
    initialX: number; // Starting mouse X coordinate
    initialY: number; // Starting mouse Y coordinate
    dragging: boolean; // Flag indicating if dragging threshold was passed
    sourceEl: HTMLElement; // The DOM element being dragged (e.g., .cm-line)
    previewEl: HTMLElement | null; // The floating preview element during drag
    editor: Editor; // Active editor instance
    lineNumber: number; // Line number in the editor being dragged (0-based)
    rawLineText: string; // Raw text content of the dragged line
}

const MAX_TEXT_LENGTH = 30; // Max length for preview text
const DRAG_THRESHOLD = 5; // Pixels mouse must move to initiate drag

/**
 * Truncates text to a maximum length, adding ellipsis if needed.
 * @param text The text to truncate.
 * @param maxLen The maximum length.
 * @returns The truncated text.
 */
function truncateText(text: string, maxLen = MAX_TEXT_LENGTH): string {
    return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}

export default class CustomBulletDragPlugin extends Plugin {
    dragState: DragState | null = null; // Holds the state of the current drag operation

    onload() {
        console.log("CustomBulletDragPlugin loaded.");
        document.addEventListener("mousedown", this.onMouseDown, true);
        document.addEventListener("mousemove", this.onMouseMove, true);
        document.addEventListener("mouseup", this.onMouseUp, true);
        document.body.addEventListener("mouseover", this.onMouseOverBullet, false);
        document.body.addEventListener("mouseout", this.onMouseOutBullet, false);
        window.addEventListener("error", this.globalErrorHandler, true);
    }

    onunload() {
        console.log("CustomBulletDragPlugin unloaded.");
        document.removeEventListener("mousedown", this.onMouseDown, true);
        document.removeEventListener("mousemove", this.onMouseMove, true);
        document.removeEventListener("mouseup", this.onMouseUp, true);
        document.body.removeEventListener("mouseover", this.onMouseOverBullet, false);
        document.body.removeEventListener("mouseout", this.onMouseOutBullet, false);
        window.removeEventListener("error", this.globalErrorHandler, true);

        if (this.dragState?.previewEl) {
            try {
                document.body.removeChild(this.dragState.previewEl);
            } catch (e) {
                console.warn("CustomBulletDrag: Could not remove preview element on unload.", e);
            }
        }
        this.dragState = null;
    }

    /**
     * Global error handler to suppress specific known, benign errors like ResizeObserver loops.
     */
    globalErrorHandler = (event: ErrorEvent): boolean => {
        if (event.message && event.message.includes("ResizeObserver loop completed with undelivered notifications")) {
            event.stopImmediatePropagation();
            return false;
        }
        return true;
    };

    /**
     * Changes cursor to 'grab' when Alt is pressed over a bullet point.
     */
    onMouseOverBullet = (e: MouseEvent) => {
		if (!e.altKey) return;
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line");
		if (bulletEl instanceof HTMLElement) {
			const text = bulletEl.textContent?.trim();
			if (text && text.startsWith("-")) {
				bulletEl.style.cursor = "grab";
			}
		}
	};
	
	onMouseOutBullet = (e: MouseEvent) => {
		const targetEl = e.target as HTMLElement;
		const bulletEl = targetEl.closest(".cm-line");
		if (bulletEl instanceof HTMLElement && bulletEl.style.cursor === "grab") {
			bulletEl.style.cursor = "";
		}
	};

    /**
     * Handles mousedown events to start a potential drag on a bullet point.
     */
    onMouseDown = (e: MouseEvent) => {
        if (!e.altKey) return;

        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
            console.warn("CustomBulletDrag: Mouse coordinates are non-finite. Aborting drag start.", { clientX: e.clientX, clientY: e.clientY });
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) return;

        const editor = view.editor;
        const cm = view.editor.cm; // Provided by our module augmentation
        if (!cm) {
            console.warn("CustomBulletDrag: Could not access CodeMirror EditorView instance (editor.cm).");
            return;
        }

        const posOffset = cm.posAtCoords({ x: e.clientX, y: e.clientY });
        if (posOffset === null) return;

        const lineNumber = cm.state.doc.lineAt(posOffset).number - 1;
        const rawLineText = editor.getLine(lineNumber);
        const trimmedLineText = rawLineText.trim();

        if (!trimmedLineText.startsWith("-")) return;

        const targetEl = e.target as HTMLElement;
        const bulletLineEl = targetEl.closest(".cm-line") as HTMLElement | null;
        if (!bulletLineEl) return;

        bulletLineEl.style.cursor = "grab";
        bulletLineEl.style.userSelect = "none";

        this.dragState = {
            initialX: e.clientX,
            initialY: e.clientY,
            dragging: false,
            sourceEl: bulletLineEl,
            previewEl: null,
            editor: editor,
            lineNumber: lineNumber,
            rawLineText: rawLineText,
        };

        console.log(`CustomBulletDrag: Alt+mousedown on line ${lineNumber}: "${rawLineText}"`);
        e.preventDefault();
        e.stopPropagation();
    };

    /**
     * Handles mousemove events to create a preview and update its position.
     */
    onMouseMove = (e: MouseEvent) => {
        if (!this.dragState) return;

        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
            console.warn("CustomBulletDrag: Mouse coordinates became non-finite during move.", { clientX: e.clientX, clientY: e.clientY });
            return;
        }

        const dx = e.clientX - this.dragState.initialX;
        const dy = e.clientY - this.dragState.initialY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!this.dragState.dragging && distance > DRAG_THRESHOLD) {
            this.dragState.dragging = true;
            this.dragState.sourceEl.style.cursor = "grabbing";

            const preview = document.createElement("div");
            preview.style.position = "fixed";
            preview.style.zIndex = "10000";
            preview.style.pointerEvents = "none";
            preview.style.display = "inline-flex";
            preview.style.alignItems = "center";
            preview.style.borderRadius = "16px";
            preview.style.backgroundColor = "var(--background-secondary)";
            preview.style.color = "var(--text-normal)";
            preview.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)";
            preview.style.padding = "6px 12px";
            preview.style.fontSize = "0.9em";
            preview.style.maxWidth = "250px";
            preview.style.overflow = "hidden";
            preview.style.textOverflow = "ellipsis";
            preview.style.whiteSpace = "nowrap";
            preview.style.fontFamily = "var(--font-interface)";

            const iconSpan = document.createElement("span");
            iconSpan.textContent = "•";
            iconSpan.style.marginRight = "8px";
            iconSpan.style.color = "var(--text-muted)";
            preview.appendChild(iconSpan);

            const bulletTextRaw = this.dragState.rawLineText.trim();
            const bulletText = bulletTextRaw.replace(/^-\s*/, "");
            const textSpan = document.createElement("span");
            textSpan.textContent = truncateText(bulletText);
            preview.appendChild(textSpan);

            document.body.appendChild(preview);
            this.dragState.previewEl = preview;

            console.log(`CustomBulletDrag: Dragging started for line ${this.dragState.lineNumber}`);
        }

        if (this.dragState.dragging && this.dragState.previewEl) {
            this.dragState.previewEl.style.left = e.clientX + 10 + "px";
            this.dragState.previewEl.style.top = e.clientY + 10 + "px";
            e.preventDefault();
        }
    };

    /**
     * Handles mouseup events to finalize the drag operation.
     */
    onMouseUp = async (e: MouseEvent) => {
        if (!this.dragState) return;

        const { editor, lineNumber, sourceEl, dragging } = this.dragState;
        const initialRawLineText = this.dragState.rawLineText;

        sourceEl.style.userSelect = "";
        sourceEl.style.cursor = "";

        if (this.dragState.previewEl) {
            try {
                document.body.removeChild(this.dragState.previewEl);
            } catch (err) {
                console.warn("CustomBulletDrag: Could not remove preview element on mouseup.", err);
            }
        }

        this.dragState = null;

        if (dragging) {
            console.log(`CustomBulletDrag: Dropped bullet from line ${lineNumber}: "${initialRawLineText}"`);

            if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
                console.error("CustomBulletDrag: Drop coordinates are non-finite. Cannot add node to canvas.", { clientX: e.clientX, clientY: e.clientY });
                return;
            }

            const file = this.app.workspace.getActiveFile();
            if (file && file.extension === "md") {
                let id = "";
                // Use a regex that matches a block id at the end of the line
                const idMatch = initialRawLineText.match(/\s\^([\w-]+)$/);
                if (idMatch) {
                    id = idMatch[1];
                    console.log(`CustomBulletDrag: Using existing block id: ^${id}`);
                } else {
                    id = this.generateBulletId();
                    console.log(`CustomBulletDrag: Generated new block id: ^${id}`);
                    await this.updateBulletInEditor(editor, lineNumber, initialRawLineText, id);
                }

                const fileNameNoExt = file.name.replace(/\.md$/, "");
                const linkReference = `![[${fileNameNoExt}#^${id}]]`;

                console.log(`CustomBulletDrag: Creating canvas node with link: ${linkReference} at (${e.clientX}, ${e.clientY})`);
                this.addCanvasNode(linkReference, e);
            } else {
                console.log("CustomBulletDrag: Drop occurred but no valid markdown file context found.");
            }
        } else {
            console.log(`CustomBulletDrag: Alt+click (no drag) on line ${lineNumber}: "${initialRawLineText}"`);
        }
    };

    /**
     * Updates the specific line in the editor to append the block ID.
     */
    async updateBulletInEditor(editor: Editor, lineNumber: number, lineText: string, id: string): Promise<void> {
        try {
            const newLineText = lineText.trimEnd() + ` ^${id}`;
            editor.setLine(lineNumber, newLineText);
            console.log(`CustomBulletDrag: Successfully updated line ${lineNumber} with id ^${id}`);
        } catch (error) {
            console.error(`CustomBulletDrag: Failed to update line ${lineNumber} in editor:`, error);
        }
    }

    /**
     * Generates a unique block ID based on timestamp and a random number.
     */
    generateBulletId(): string {
        return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }

    /**
     * Finds the Canvas leaf under the drop coordinates and adds a new text node with the block reference.
     */
    addCanvasNode(linkReference: string, e: MouseEvent) {
        const canvasLeaves = this.app.workspace.getLeavesOfType("canvas");
        const canvasLeaf = canvasLeaves.find((leaf: WorkspaceLeaf) => {
            const canvasView = leaf.view as CanvasView;
            if (canvasView?.getViewType && canvasView.getViewType() === "canvas" && canvasView.containerEl) {
                const rect = canvasView.containerEl.getBoundingClientRect();
                return e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
            }
            return false;
        });

        if (canvasLeaf) {
            const canvasView = canvasLeaf.view as CanvasView;
            if (canvasView.canvas && typeof canvasView.canvas.posFromEvt === "function") {
                const canvasCoords = canvasView.canvas.posFromEvt(e);
                console.log("CustomBulletDrag: Using canvas.posFromEvt for coordinates.");

                if (!Number.isFinite(canvasCoords.x) || !Number.isFinite(canvasCoords.y)) {
                    console.error("CustomBulletDrag: Failed to convert client coordinates to valid canvas coordinates.", { canvasCoords });
                    return;
                }

                canvasView.canvas.createTextNode({
                    pos: canvasCoords,
                    text: linkReference,
                    size: { height: 50, width: 200 },
                    save: true,
                    focus: true,
                });
                console.log("CustomBulletDrag: Node added to canvas successfully.");
            } else {
                console.error("CustomBulletDrag: posFromEvt API is not available on the canvas view object.");
            }
        } else {
            console.log("CustomBulletDrag: No canvas found under drop coordinates.");
        }
    }
}
