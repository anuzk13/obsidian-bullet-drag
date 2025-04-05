import { EditorView } from "@codemirror/view";

declare module "obsidian" {
    // Extend the Editor interface with a CodeMirror EditorView instance.
    interface Editor {
        cm: EditorView;
    }
}
