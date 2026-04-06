use aeqi_graph::*;

const TRAITS_RS: &str = r#"
/// Observability trait for the agent loop.
pub trait Observer: Send + Sync {
    fn record(&self, event: Event);
    fn name(&self) -> &str;
}

pub struct LogObserver;

impl Observer for LogObserver {
    fn record(&self, event: Event) {}
    fn name(&self) -> &str { "log" }
}
"#;

const AGENT_RS: &str = r#"
use crate::traits::{Observer, LogObserver};

pub struct Agent {
    observer: Box<dyn Observer>,
}

impl Agent {
    pub fn new() -> Self {
        let observer = LogObserver;
        observer.record(Event::Start);
        Self { observer: Box::new(observer) }
    }

    pub fn run(&self) {
        self.observer.record(Event::End);
    }
}
"#;

#[test]
fn full_pipeline_parse_resolve_query() {
    let provider = RustProvider::new();

    // Phase 1: Parse
    let mut all_nodes = Vec::new();
    let mut all_edges = Vec::new();

    let ext1 = provider.extract(TRAITS_RS, "src/traits.rs").unwrap();
    all_nodes.extend(ext1.nodes);
    all_edges.extend(ext1.edges);

    let ext2 = provider.extract(AGENT_RS, "src/agent.rs").unwrap();
    all_nodes.extend(ext2.nodes);
    all_edges.extend(ext2.edges);

    // Phase 2: Resolve
    let (resolved_edges, _unresolved) =
        resolve_graph(&all_nodes, all_edges, &std::collections::HashMap::new());

    // Some unresolved is expected (Event, Box, etc. are external)
    assert!(
        resolved_edges
            .iter()
            .any(|e| e.edge_type == EdgeType::Implements && e.confidence > 0.8),
        "Observer impl should be resolved with high confidence"
    );

    // Phase 3: Store and query
    let store = GraphStore::open_in_memory().unwrap();
    store.batch_insert(&all_nodes, &resolved_edges).unwrap();

    let stats = store.stats().unwrap();
    assert!(
        stats.node_count >= 6,
        "should have traits, struct, impl, methods, file nodes"
    );
    assert!(
        stats.edge_count >= 4,
        "should have contains, has_method, implements, calls edges"
    );

    // Search for Observer
    let results = store.search_nodes("Observer", 5).unwrap();
    assert!(!results.is_empty(), "FTS should find Observer");
    assert!(
        results.iter().any(|n| n.name == "Observer"),
        "results should contain the Observer node"
    );

    // 360° context for Observer trait
    let observer_node = all_nodes
        .iter()
        .find(|n| n.name == "Observer" && n.label == NodeLabel::Trait)
        .unwrap();
    let ctx = store.context(&observer_node.id).unwrap();
    assert_eq!(ctx.node.name, "Observer");
    // LogObserver implements Observer
    assert!(
        !ctx.implementors.is_empty(),
        "should have at least LogObserver as implementor"
    );

    // Impact: changing Observer should affect LogObserver and Agent
    let impact = store.impact(&[&observer_node.id], 3).unwrap();
    assert!(
        !impact.is_empty(),
        "changing Observer should have downstream impact"
    );

    // Verify we can find files
    let file_nodes = store.nodes_in_file("src/traits.rs").unwrap();
    assert!(!file_nodes.is_empty());
}
