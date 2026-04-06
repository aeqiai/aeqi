pub mod community;
pub mod process;
pub mod synthesis;

pub use community::detect_communities;
pub use process::detect_processes;
pub use synthesis::{SynthesizedPrompt, synthesize_prompt};
