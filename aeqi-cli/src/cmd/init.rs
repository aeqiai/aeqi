use anyhow::Result;

pub(crate) async fn cmd_init() -> Result<()> {
    super::setup::cmd_setup("openrouter_agent", true, false, false).await
}
