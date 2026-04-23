use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let ui_dist_dir = manifest_dir.join("../../apps/ui/dist");
    let index_path = ui_dist_dir.join("index.html");

    if !ui_dist_dir.exists() {
        fs::create_dir_all(&ui_dist_dir).expect("create apps/ui/dist");
    }

    if !index_path.exists() {
        fs::write(
            &index_path,
            "<!doctype html><html><body><h1>AEQI UI assets not built</h1></body></html>\n",
        )
        .expect("write placeholder embedded UI");
    }

    println!("cargo:rerun-if-changed=../../apps/ui/dist");
    println!("cargo:rerun-if-changed=build.rs");
}
