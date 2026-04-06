use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../apps/ui/dist"]
#[prefix = ""]
pub struct Assets;
