use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::storage::GraphStore;

/// One answerability check for graph search quality.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchBenchmarkCase {
    pub id: String,
    pub query: String,
    pub expected: Vec<String>,
    pub limit: usize,
}

impl SearchBenchmarkCase {
    pub fn parse(spec: &str, default_limit: usize) -> Result<Self> {
        let (left, expected_raw) = spec
            .split_once("=>")
            .or_else(|| spec.split_once("::"))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "benchmark case must use '<id>|<query>=>expected_a,expected_b' or '<query>=>expected'"
                )
            })?;

        let (id, query) = match left.split_once('|') {
            Some((id, query)) => (id.trim().to_string(), query.trim().to_string()),
            None => {
                let query = left.trim().to_string();
                (stable_case_id(&query), query)
            }
        };

        let expected: Vec<String> = expected_raw
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect();

        if id.is_empty() {
            bail!("benchmark case id is empty");
        }
        if query.is_empty() {
            bail!("benchmark case query is empty");
        }
        if expected.is_empty() {
            bail!("benchmark case must name at least one expected symbol");
        }

        Ok(Self {
            id,
            query,
            expected,
            limit: default_limit.max(1),
        })
    }
}

/// Score for one benchmark case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchBenchmarkResult {
    pub id: String,
    pub query: String,
    pub expected: Vec<String>,
    pub found: Vec<String>,
    pub missed: Vec<String>,
    pub result_names: Vec<String>,
    pub recall: f32,
    pub mrr: f32,
    pub passed: bool,
}

/// Aggregate benchmark report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchBenchmarkReport {
    pub results: Vec<SearchBenchmarkResult>,
    pub average_recall: f32,
    pub average_mrr: f32,
    pub passed: bool,
    pub min_recall: f32,
}

pub fn run_search_benchmark(
    store: &GraphStore,
    cases: &[SearchBenchmarkCase],
    min_recall: f32,
) -> Result<SearchBenchmarkReport> {
    if cases.is_empty() {
        bail!("at least one benchmark case is required");
    }

    let mut results = Vec::with_capacity(cases.len());
    for case in cases {
        let nodes = store.search_nodes(&case.query, case.limit)?;
        let result_names: Vec<String> = nodes.iter().map(|node| node.name.clone()).collect();
        let lower_names: Vec<String> = result_names
            .iter()
            .map(|name| name.to_ascii_lowercase())
            .collect();

        let mut found = Vec::new();
        let mut missed = Vec::new();
        let mut first_rank = None;
        for expected in &case.expected {
            let expected_lower = expected.to_ascii_lowercase();
            if let Some(index) = lower_names.iter().position(|name| name == &expected_lower) {
                found.push(expected.clone());
                first_rank.get_or_insert(index + 1);
            } else {
                missed.push(expected.clone());
            }
        }

        let recall = found.len() as f32 / case.expected.len() as f32;
        let mrr = first_rank.map(|rank| 1.0 / rank as f32).unwrap_or(0.0);
        results.push(SearchBenchmarkResult {
            id: case.id.clone(),
            query: case.query.clone(),
            expected: case.expected.clone(),
            found,
            missed,
            result_names,
            recall,
            mrr,
            passed: recall >= min_recall,
        });
    }

    let average_recall = average(results.iter().map(|result| result.recall));
    let average_mrr = average(results.iter().map(|result| result.mrr));
    let passed = results.iter().all(|result| result.passed);

    Ok(SearchBenchmarkReport {
        results,
        average_recall,
        average_mrr,
        passed,
        min_recall,
    })
}

fn average(values: impl Iterator<Item = f32>) -> f32 {
    let mut sum = 0.0;
    let mut count = 0usize;
    for value in values {
        sum += value;
        count += 1;
    }
    if count == 0 { 0.0 } else { sum / count as f32 }
}

fn stable_case_id(query: &str) -> String {
    query
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(6)
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CodeNode, GraphStore, NodeLabel};

    #[test]
    fn parses_case_with_explicit_id() {
        let case = SearchBenchmarkCase::parse(
            "graph-search|kind:method search_nodes=>search_nodes,context",
            10,
        )
        .unwrap();

        assert_eq!(case.id, "graph-search");
        assert_eq!(case.query, "kind:method search_nodes");
        assert_eq!(case.expected, vec!["search_nodes", "context"]);
        assert_eq!(case.limit, 10);
    }

    #[test]
    fn scores_recall_and_mrr() {
        let store = GraphStore::open_in_memory().unwrap();
        store
            .upsert_node(&CodeNode::new(
                NodeLabel::Method,
                "search_nodes",
                "src/storage.rs",
                1,
                10,
                "rust",
            ))
            .unwrap();
        store
            .upsert_node(&CodeNode::new(
                NodeLabel::Method,
                "context",
                "src/storage.rs",
                12,
                20,
                "rust",
            ))
            .unwrap();

        let cases = vec![
            SearchBenchmarkCase::parse(
                "storage|kind:method path:storage search_nodes=>search_nodes,context",
                10,
            )
            .unwrap(),
        ];
        let report = run_search_benchmark(&store, &cases, 0.5).unwrap();

        assert!(report.passed);
        assert_eq!(report.results[0].found, vec!["search_nodes"]);
        assert_eq!(report.results[0].missed, vec!["context"]);
        assert_eq!(report.results[0].recall, 0.5);
        assert_eq!(report.results[0].mrr, 1.0);
    }
}
