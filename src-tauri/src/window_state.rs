use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Represents the cursor position in a text editor
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPosition {
    /// Line number (0-based)
    pub line: usize,
    /// Column number (0-based)
    pub column: usize,
}

/// Represents the active editor state with cursor information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveEditorState {
    /// File path of the active editor
    pub path: String,
    /// Current cursor position
    pub cursor: CursorPosition,
    /// Optional selection range (start and end positions)
    pub selection: Option<(CursorPosition, CursorPosition)>,
}

#[derive(Clone, Default)]
pub struct WindowState {
    pub open_tabs: Arc<RwLock<Vec<String>>>,
    pub active_editor: Arc<RwLock<Option<ActiveEditorState>>>,
}
