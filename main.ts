import { Plugin, WorkspaceLeaf, TFile, MarkdownView, Editor, EditorPosition } from "obsidian";
// Import EditorView from CodeMirror
import { EditorView } from "@codemirror/view";

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
        // Use capture phase for mousedown to potentially intercept before default handling
        document.addEventListener("mousedown", this.onMouseDown, true);
        // Use capture phase for mousemove/mouseup to ensure they are caught even if mouse leaves original target
        document.addEventListener("mousemove", this.onMouseMove, true);
        document.addEventListener("mouseup", this.onMouseUp, true);

        // Use bubbling phase for mouseover/out for efficiency
        document.body.addEventListener("mouseover", this.onMouseOverBullet, false);
        document.body.addEventListener("mouseout", this.onMouseOutBullet, false);

        // Add global error handler for specific ignorable errors
        window.addEventListener("error", this.globalErrorHandler, true);
    }

    onunload() {
        console.log("CustomBulletDragPlugin unloaded.");
        // Clean up all event listeners
        document.removeEventListener("mousedown", this.onMouseDown, true);
        document.removeEventListener("mousemove", this.onMouseMove, true);
        document.removeEventListener("mouseup", this.onMouseUp, true);
        document.body.removeEventListener("mouseover", this.onMouseOverBullet, false);
        document.body.removeEventListener("mouseout", this.onMouseOutBullet, false);
        window.removeEventListener("error", this.globalErrorHandler, true);

        // Clean up any lingering drag state visuals if plugin is unloaded mid-drag
        if (this.dragState?.previewEl) {
            // Use try-catch as body might not exist in some teardown scenarios
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
            // Prevent this specific error from propagating and potentially logging to console
            event.stopImmediatePropagation();
            return false; // Indicate error is handled
        }
        // Allow other errors to propagate
        return true;
    };

    /**
     * Handles mouseover events to change cursor to 'grab' when Alt is pressed over a bullet point.
     */
    onMouseOverBullet = (e: MouseEvent) => {
        // Only activate grab cursor if Alt key is held down
        if (!e.altKey) return;

        const targetEl = e.target as HTMLElement;
        // Find the closest CodeMirror line element
        const bulletEl = targetEl.closest(".cm-line");

        if (bulletEl) {
            // Check if the line *looks* like a bullet point (basic check)
            // Note: We verify the actual content via Editor API in onMouseDown
            const text = bulletEl.textContent?.trim();
            if (text && text.startsWith("-")) {
                (bulletEl as HTMLElement).style.cursor = "grab";
            }
        }
    };

    /**
     * Handles mouseout events to reset the cursor when moving away from a potential bullet point.
     */
    onMouseOutBullet = (e: MouseEvent) => {
        const targetEl = e.target as HTMLElement;
        const bulletEl = targetEl.closest(".cm-line");
        // Reset cursor if it was previously set to 'grab'
        if (bulletEl && (bulletEl as HTMLElement).style.cursor === "grab") {
            (bulletEl as HTMLElement).style.cursor = "";
        }
    };

    /**
     * Handles mousedown events to initiate a potential drag operation on a bullet point.
     * Uses the underlying CodeMirror EditorView API to get the position.
     */
    onMouseDown = (e: MouseEvent) => {
        // Only proceed if Alt key is pressed
        if (!e.altKey) return;

        // Check for non-finite coordinates
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
            console.warn("CustomBulletDrag: Mouse coordinates are non-finite. Aborting drag start.", { clientX: e.clientX, clientY: e.clientY });
            return;
        }

        // Get the active Markdown view and editor instance
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.editor) {
            return; // Not in a markdown editor
        }
        const editor = view.editor;

        // --- Access CodeMirror EditorView ---
        // Access the underlying CodeMirror EditorView instance.
        // Note: '.cm' might be an internal/undocumented property on the Obsidian 'Editor' type,
        // potentially requiring '@ts-ignore' if TypeScript definitions don't explicitly include it.
        // This pattern is observed in various community plugins but may be subject to change.
		//@ts-ignore
        const cm = view.editor.cm as EditorView;
        if (!cm) {
             console.warn("CustomBulletDrag: Could not access CodeMirror EditorView instance (editor.cm).");
             return;
        }

        // --- Use EditorView.posAtCoords ---
        // Get the character offset position from coordinates
        const posOffset = cm.posAtCoords({ x: e.clientX, y: e.clientY });

        // posAtCoords returns null if the coordinates are outside the document content
        if (posOffset === null) {
            // console.log("CustomBulletDrag: Click coordinates are outside the editor content area.");
            return;
        }

        // Convert the character offset to a line number
        // CodeMirror line numbers are 1-based, Obsidian API uses 0-based.
        const lineNumber = cm.state.doc.lineAt(posOffset).number - 1;
        // --- End CodeMirror Access ---


        // Get the raw Markdown text of the clicked line using the Obsidian Editor API
        const rawLineText = editor.getLine(lineNumber);
        const trimmedLineText = rawLineText.trim();

        // Verify if the clicked line actually starts with a bullet marker
        // Allow for leading whitespace before the dash
        if (!trimmedLineText.startsWith("-")) {
            // console.log("Clicked line is not a bullet point:", rawLineText);
            return; // Not a bullet line
        }

        // Try to find the corresponding DOM element (.cm-line) for visual feedback
        const targetEl = e.target as HTMLElement;
        // Ensure we get the cm-line element itself, not a child span
        const bulletLineEl = targetEl.closest(".cm-line") as HTMLElement | null;


        if (!bulletLineEl) {
            // console.log("Could not find .cm-line element for the clicked position.");
            return; // Abort if we can't get the visual element
        }

        // Prepare for drag: set cursor and prevent text selection
        bulletLineEl.style.cursor = "grab"; // Indicate draggable
        bulletLineEl.style.userSelect = "none"; // Prevent selecting text

        // Initialize drag state using Editor API data
        this.dragState = {
            initialX: e.clientX,
            initialY: e.clientY,
            dragging: false,
            sourceEl: bulletLineEl, // The DOM element for visual reference
            previewEl: null,
            editor: editor, // Store Obsidian editor instance
            lineNumber: lineNumber, // Store 0-based line number
            rawLineText: rawLineText, // Store exact raw line text
        };

        console.log(`CustomBulletDrag: Alt+mousedown on line ${lineNumber}: "${rawLineText}"`);

        // Prevent default browser drag behavior and stop propagation
        e.preventDefault();
        e.stopPropagation();
    };

    /**
     * Handles mousemove events during a potential drag. Creates a preview element
     * and updates its position once the drag threshold is exceeded.
     */
    onMouseMove = (e: MouseEvent) => {
        // Only run if drag state is initialized
        if (!this.dragState) return;

         // Check for non-finite coordinates during move
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
            console.warn("CustomBulletDrag: Mouse coordinates became non-finite during move.", { clientX: e.clientX, clientY: e.clientY });
            return; // Prevent further processing for this event
        }

        // Calculate distance moved from mousedown position
        const dx = e.clientX - this.dragState.initialX;
        const dy = e.clientY - this.dragState.initialY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If not already dragging and threshold is met, start the drag
        if (!this.dragState.dragging && distance > DRAG_THRESHOLD) {
            this.dragState.dragging = true;
            this.dragState.sourceEl.style.cursor = "grabbing"; // Update cursor

            // Create the visual preview element
            const preview = document.createElement("div");
            preview.style.position = "fixed"; // Use fixed positioning relative to viewport
            preview.style.zIndex = "10000"; // Ensure it's on top
            preview.style.pointerEvents = "none"; // Allow clicks/hovers to pass through
            preview.style.display = "inline-flex";
            preview.style.alignItems = "center";
            preview.style.borderRadius = "16px"; // Rounded corners
            preview.style.backgroundColor = "var(--background-secondary)"; // Use Obsidian theme variable
            preview.style.color = "var(--text-normal)"; // Use Obsidian theme variable
            preview.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)"; // Softer shadow
            preview.style.padding = "6px 12px"; // Slightly larger padding
            preview.style.fontSize = "0.9em";
            preview.style.maxWidth = "250px"; // Max width for preview
            preview.style.overflow = "hidden";
            preview.style.textOverflow = "ellipsis";
            preview.style.whiteSpace = "nowrap";
            preview.style.fontFamily = "var(--font-interface)"; // Use interface font

            // Add bullet icon
            const iconSpan = document.createElement("span");
            iconSpan.textContent = "•";
            iconSpan.style.marginRight = "8px"; // Space after icon
            iconSpan.style.color = "var(--text-muted)"; // Muted color for icon
            preview.appendChild(iconSpan);

            // Get the text content from the stored raw line text
            const bulletTextRaw = this.dragState.rawLineText.trim();
            // Remove the leading bullet marker ("- ") for the preview text
            const bulletText = bulletTextRaw.replace(/^-\s*/, "");

            // Add truncated text
            const textSpan = document.createElement("span");
            textSpan.textContent = truncateText(bulletText); // Use the truncation function
            preview.appendChild(textSpan);

            // Add preview to body and store reference
            document.body.appendChild(preview);
            this.dragState.previewEl = preview;

            console.log(`CustomBulletDrag: Dragging started for line ${this.dragState.lineNumber}`);
        }

        // If dragging, update preview position to follow the cursor
        if (this.dragState.dragging && this.dragState.previewEl) {
            // Position slightly offset from cursor
            this.dragState.previewEl.style.left = e.clientX + 10 + "px";
            this.dragState.previewEl.style.top = e.clientY + 10 + "px";
            // Prevent default actions during drag (like text selection)
            e.preventDefault();
        }
    };

    /**
     * Handles mouseup events to finalize the drag operation.
     * If dragging occurred, it checks/adds a block ID to the source line
     * and attempts to add a node to a Canvas if dropped over one.
     */
    onMouseUp = async (e: MouseEvent) => {
        // Only run if drag state exists
        if (!this.dragState) return;

        // Destructure state for easier access
        const { editor, lineNumber, sourceEl, dragging } = this.dragState;
        // Get the rawLineText from the state *before* clearing it
        const initialRawLineText = this.dragState.rawLineText;


        // Always reset styles on the source element regardless of drag status
        sourceEl.style.userSelect = ""; // Re-enable text selection
        sourceEl.style.cursor = ""; // Reset cursor

        // Remove the preview element if it exists
        if (this.dragState.previewEl) {
             try {
                 document.body.removeChild(this.dragState.previewEl);
             } catch (err) {
                 console.warn("CustomBulletDrag: Could not remove preview element on mouseup.", err);
             }
        }

        // --- Store drag state locally and clear global state ---
        // This prevents issues if async operations below take time or fail
        const currentDragState = this.dragState;
        this.dragState = null; // Clear global state immediately
        // ---

        // If the mouse moved enough to be considered a drag
        if (dragging) {
            console.log(`CustomBulletDrag: Dropped bullet from line ${lineNumber}: "${initialRawLineText}"`);

             // Check for non-finite coordinates on drop
            if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
                console.error("CustomBulletDrag: Drop coordinates are non-finite. Cannot add node to canvas.", { clientX: e.clientX, clientY: e.clientY });
                return; // Abort drop processing
            }

            // Get the active file associated with the editor
            const file = this.app.workspace.getActiveFile();

            // Ensure we are still in a valid markdown file context
            if (file && file.extension === "md") {
                let id = "";
                // Check if the raw line text (captured at mousedown) already ends with a block ID
                const idMatch = initialRawLineText.match(/\s\^(\w+)$/);

                if (idMatch) {
                    // Use the existing block ID
                    id = idMatch[1];
                    console.log(`CustomBulletDrag: Using existing block id: ^${id}`);
                } else {
                    // Check if the raw line text (captured at mousedown) already ends with a block ID.
					// Updated regex to capture letters, numbers, underscores, and dashes.
					const idMatch = initialRawLineText.match(/\s\^([\w-]+)$/);

					if (idMatch) {
						// If an ID already exists, reuse it.
						id = idMatch[1];
						console.log(`CustomBulletDrag: Using existing block id: ^${id}`);
					} else {
						// Generate a new unique block ID if none is found.
						id = this.generateBulletId();
						console.log(`CustomBulletDrag: Generated new block id: ^${id}`);
						// Update the line in the editor with the new block ID.
						await this.updateBulletInEditor(editor, lineNumber, initialRawLineText, id);
					}
                }

                // Construct the Obsidian block reference link
                const fileNameNoExt = file.name.replace(/\.md$/, "");
                const linkReference = `![[${fileNameNoExt}#^${id}]]`;

                console.log(`CustomBulletDrag: Creating canvas node with link: ${linkReference} at (${e.clientX}, ${e.clientY})`);
                // Attempt to add the node to the canvas under the drop coordinates
                this.addCanvasNode(linkReference, e);

            } else {
                console.log("CustomBulletDrag: Drop occurred but no valid markdown file context found.");
            }
        } else {
            // If mouseup occurred without significant movement (i.e., just a click)
            console.log(`CustomBulletDrag: Alt+click (no drag) on line ${lineNumber}: "${initialRawLineText}"`);
        }

        // Global drag state is already cleared
    };

    /**
     * Updates the specific line in the editor to append the block ID.
     * @param editor The Editor instance.
     * @param lineNumber The 0-based line number to update.
     * @param lineText The original raw text of the line.
     * @param id The block ID to append.
     */
    async updateBulletInEditor(editor: Editor, lineNumber: number, lineText: string, id: string): Promise<void> {
        try {
            // Construct the new line text by appending the ID.
            // trimEnd() ensures no double spaces if the line already had trailing space.
            const newLineText = lineText.trimEnd() + ` ^${id}`;
            // Use the editor's setLine method to replace the content of the specific line
            editor.setLine(lineNumber, newLineText);
            console.log(`CustomBulletDrag: Successfully updated line ${lineNumber} with id ^${id}`);
        } catch (error) {
            console.error(`CustomBulletDrag: Failed to update line ${lineNumber} in editor:`, error);
            // Optionally notify the user about the failure
            // new Notice("Failed to add ID to the bullet point.");
        }
    }

    /**
     * Generates a unique block ID based on timestamp and random number.
     * @returns A string suitable for use as an Obsidian block ID.
     */
    generateBulletId(): string {
        // Simple timestamp + random number combination for uniqueness
        return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }

    /**
     * Finds the Canvas leaf under the drop coordinates and adds a new text node
     * containing the block reference link.
     * @param linkReference The Obsidian link string (e.g., ![[File#^id]]).
     * @param x The clientX coordinate of the drop. Should be finite.
     * @param y The clientY coordinate of the drop. Should be finite.
     */
    addCanvasNode(linkReference: string, e: MouseEvent) {
		// Find the canvas leaf as before
		const canvasLeaves = this.app.workspace.getLeavesOfType("canvas");
		const canvasLeaf = canvasLeaves.find((leaf: WorkspaceLeaf) => {
			const canvasView = leaf.view as any;
			if (canvasView?.getViewType && canvasView.getViewType() === "canvas" && canvasView.containerEl) {
				const rect = canvasView.containerEl.getBoundingClientRect();
				return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
			}
			return false;
		});
		
		if (canvasLeaf) {
			const canvasView = canvasLeaf.view as any;
			if (canvasView.canvas && typeof canvasView.canvas.posFromEvt === "function") {
				// Use the new public API method for coordinate conversion
				const canvasCoords = canvasView.canvas.posFromEvt(e);
				console.log("CustomBulletDrag: Using canvas.posFromEvt for coordinates.");
	
				// Validate coordinates
				if (!Number.isFinite(canvasCoords.x) || !Number.isFinite(canvasCoords.y)) {
					console.error("CustomBulletDrag: Failed to convert client coordinates to valid canvas coordinates.", { canvasCoords });
					return;
				}
	
				// Create the text node on the canvas using the converted coordinates
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
