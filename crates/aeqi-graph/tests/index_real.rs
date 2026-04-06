use aeqi_graph::*;
use std::path::Path;

#[test]
fn index_aeqi_core() {
    let store = GraphStore::open_in_memory().unwrap();
    let indexer = Indexer::new();

    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("aeqi-core");

    let result = indexer.index(&project_dir, &store).unwrap();

    println!("Index result: {result}");

    // aeqi-core has many Rust files
    assert!(
        result.files_parsed >= 5,
        "expected >=5 files, got {}",
        result.files_parsed
    );
    assert!(
        result.nodes >= 50,
        "expected >=50 nodes, got {}",
        result.nodes
    );
    assert!(
        result.edges >= 20,
        "expected >=20 edges, got {}",
        result.edges
    );

    // Should find the Observer trait (search by name, also try FTS)
    let results = store.search_nodes("observer", 10).unwrap();
    println!(
        "FTS 'observer' results: {:?}",
        results
            .iter()
            .map(|n| (&n.name, &n.label))
            .collect::<Vec<_>>()
    );
    assert!(
        !results.is_empty(),
        "FTS should find observer-related nodes"
    );

    // Find Observer trait by scanning nodes in its file
    let trait_files = store.nodes_in_file("src/traits/observer.rs").unwrap();
    let observer = trait_files
        .iter()
        .find(|n| n.label == NodeLabel::Trait && n.name == "Observer")
        .expect("Observer trait should exist in src/traits/observer.rs");

    // Should find the Agent struct
    let agent_files = store.nodes_in_file("src/agent.rs").unwrap();
    let agent = agent_files
        .iter()
        .find(|n| n.name == "Agent")
        .expect("Agent should exist in src/agent.rs");

    let ctx = store.context(&observer.id).unwrap();
    let _agent = agent; // used above
    println!(
        "Observer context: {} callers, {} callees, {} implementors, {} in, {} out",
        ctx.callers.len(),
        ctx.callees.len(),
        ctx.implementors.len(),
        ctx.incoming_count,
        ctx.outgoing_count,
    );

    // Observer should have HasMethod edges (record, name, before_model, etc.)
    assert!(
        ctx.outgoing_count >= 2,
        "Observer should have outgoing edges (HasMethod etc)"
    );

    // Stats
    let stats = store.stats().unwrap();
    println!(
        "Graph: {} nodes, {} edges, {} files",
        stats.node_count, stats.edge_count, stats.file_count
    );

    // Communities
    if result.communities > 0 {
        println!("Detected {} communities", result.communities);
    }

    // Processes
    if result.processes > 0 {
        println!("Detected {} processes", result.processes);
    }
}
