//! Pure temporal filtering for "what did we know before X?" queries.
//!
//! Removes results whose `created_at` timestamp is strictly after the given
//! cutoff. Results with no timestamp are preserved (conservative: don't drop
//! data we can't date).

use chrono::{DateTime, Utc};

/// Filters results by creation time for time-travel queries.
pub struct TemporalFilter;

impl TemporalFilter {
    /// Remove results whose timestamp is strictly after the cutoff.
    ///
    /// The `created_at` extractor returns the creation time of each result,
    /// or `None` if the result is undated. Undated results are kept.
    pub fn apply<T, F>(results: &mut Vec<T>, cutoff: DateTime<Utc>, created_at: F)
    where
        F: Fn(&T) -> Option<DateTime<Utc>>,
    {
        results.retain(|r| match created_at(r) {
            Some(ts) => ts <= cutoff,
            None => true,
        });
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    struct Item {
        id: &'static str,
        created_at: Option<DateTime<Utc>>,
    }

    fn make(id: &'static str, created_at: Option<DateTime<Utc>>) -> Item {
        Item { id, created_at }
    }

    #[test]
    fn temporal_filter_removes_after_cutoff() {
        let cutoff = Utc::now() - Duration::days(7);
        let mut results = vec![
            make("old", Some(Utc::now() - Duration::days(30))),
            make("recent", Some(Utc::now())),
            make("edge", Some(cutoff)),
        ];

        TemporalFilter::apply(&mut results, cutoff, |r| r.created_at);
        assert_eq!(results.len(), 2, "result after cutoff should be removed");
        let ids: Vec<&str> = results.iter().map(|r| r.id).collect();
        assert!(ids.contains(&"old"));
        assert!(
            ids.contains(&"edge"),
            "result exactly at cutoff should be kept"
        );
    }

    #[test]
    fn temporal_filter_keeps_all_before_cutoff() {
        let cutoff = Utc::now() + Duration::days(1); // future cutoff
        let mut results = vec![
            make("a", Some(Utc::now())),
            make("b", Some(Utc::now() - Duration::days(5))),
        ];

        TemporalFilter::apply(&mut results, cutoff, |r| r.created_at);
        assert_eq!(
            results.len(),
            2,
            "all results before future cutoff should be kept"
        );
    }

    #[test]
    fn temporal_filter_preserves_undated_results() {
        let cutoff = Utc::now() - Duration::days(7);
        let mut results = vec![
            make("dated-old", Some(Utc::now() - Duration::days(30))),
            make("undated", None),
            make("dated-new", Some(Utc::now())),
        ];

        TemporalFilter::apply(&mut results, cutoff, |r| r.created_at);
        assert_eq!(results.len(), 2);
        let ids: Vec<&str> = results.iter().map(|r| r.id).collect();
        assert!(ids.contains(&"dated-old"));
        assert!(
            ids.contains(&"undated"),
            "undated results should be preserved (conservative)"
        );
    }

    #[test]
    fn temporal_filter_empty_results_noop() {
        let cutoff = Utc::now();
        let mut results: Vec<Item> = vec![];
        TemporalFilter::apply(&mut results, cutoff, |r| r.created_at);
        assert!(results.is_empty());
    }

    #[test]
    fn temporal_filter_removes_all_if_all_after_cutoff() {
        let cutoff = Utc::now() - Duration::days(365);
        let mut results = vec![
            make("a", Some(Utc::now())),
            make("b", Some(Utc::now() - Duration::days(30))),
        ];

        TemporalFilter::apply(&mut results, cutoff, |r| r.created_at);
        assert!(
            results.is_empty(),
            "all results after cutoff should be removed"
        );
    }
}
