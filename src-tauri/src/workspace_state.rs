use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Default)]
pub struct WorkspaceState {
    pub current: Arc<RwLock<Option<String>>>,
}
