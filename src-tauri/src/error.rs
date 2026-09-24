use serde::Serialize;

/// Anything the app can fail at, in a shape the front end can render.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    /// A refusal, not a crash: the app declined to do something unsafe.
    #[error("{0}")]
    Refused(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn refused(msg: impl Into<String>) -> Self {
        AppError::Refused(msg.into())
    }
    pub fn other(msg: impl Into<String>) -> Self {
        AppError::Other(msg.into())
    }
}

impl Serialize for AppError {
    // Spelled out because the `Result` alias below shadows the std one in this module.
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
