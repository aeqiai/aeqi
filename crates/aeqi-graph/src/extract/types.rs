use std::collections::HashMap;
use tracing::debug;

// Type inference for Rust call resolution.

/// Per-file type environment: maps variable names to type names.
/// Used during call resolution to resolve `x.method()` by looking up x's type.
#[derive(Debug, Default)]
pub struct TypeEnv {
    /// scope → variable_name → type_name
    /// scope="" is file-level, scope="function_name" is local
    bindings: HashMap<String, HashMap<String, String>>,
}

impl TypeEnv {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a binding: variable_name has type type_name in the given scope.
    pub fn bind(&mut self, scope: &str, var_name: &str, type_name: &str) {
        self.bindings
            .entry(scope.to_string())
            .or_default()
            .insert(var_name.to_string(), type_name.to_string());
    }

    /// Look up a variable's type, checking local scope first, then file scope.
    pub fn resolve_type(&self, scope: &str, var_name: &str) -> Option<&str> {
        // Check local scope first
        if !scope.is_empty()
            && let Some(bindings) = self.bindings.get(scope)
            && let Some(type_name) = bindings.get(var_name)
        {
            return Some(type_name);
        }
        // Fall back to file scope
        self.bindings
            .get("")
            .and_then(|b| b.get(var_name))
            .map(|s| s.as_str())
    }

    pub fn binding_count(&self) -> usize {
        self.bindings.values().map(|m| m.len()).sum()
    }
}

/// Build a TypeEnv for a Rust source file by analyzing tree-sitter AST patterns.
pub fn build_type_env_rust(source: &str, file_path: &str) -> TypeEnv {
    let mut env = TypeEnv::new();

    let language: tree_sitter::Language = tree_sitter_rust::LANGUAGE.into();
    let mut parser = tree_sitter::Parser::new();
    if parser.set_language(&language).is_err() {
        return env;
    }

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return env,
    };

    let root = tree.root_node();
    collect_bindings_rust(root, source, "", &mut env);

    debug!(
        file = file_path,
        bindings = env.binding_count(),
        "type env built"
    );

    env
}

fn collect_bindings_rust(node: tree_sitter::Node, source: &str, scope: &str, env: &mut TypeEnv) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "let_declaration" => {
                extract_let_binding(&child, source, scope, env);
            }
            "function_item" => {
                // Enter function scope
                let func_scope = child
                    .child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("");
                if !func_scope.is_empty() {
                    // Register function's parameters with their types
                    if let Some(params) = child.child_by_field_name("parameters") {
                        extract_params(&params, source, func_scope, env);
                    }
                    // Recurse into function body
                    if let Some(body) = child.child_by_field_name("body") {
                        collect_bindings_rust(body, source, func_scope, env);
                    }
                }
            }
            "impl_item" => {
                // Recurse into impl body
                if let Some(body) = child.child_by_field_name("body") {
                    let mut icursor = body.walk();
                    for ichild in body.children(&mut icursor) {
                        if ichild.kind() == "function_item" {
                            let method_scope = ichild
                                .child_by_field_name("name")
                                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                                .unwrap_or("");
                            if !method_scope.is_empty() {
                                // self has the impl's type
                                if let Some(type_node) = child.child_by_field_name("type")
                                    && let Ok(type_name) = type_node.utf8_text(source.as_bytes())
                                {
                                    env.bind(method_scope, "self", type_name);
                                }
                                if let Some(params) = ichild.child_by_field_name("parameters") {
                                    extract_params(&params, source, method_scope, env);
                                }
                                if let Some(body) = ichild.child_by_field_name("body") {
                                    collect_bindings_rust(body, source, method_scope, env);
                                }
                            }
                        }
                    }
                }
            }
            _ => {
                collect_bindings_rust(child, source, scope, env);
            }
        }
    }
}

fn extract_let_binding(node: &tree_sitter::Node, source: &str, scope: &str, env: &mut TypeEnv) {
    let pattern = match node.child_by_field_name("pattern") {
        Some(p) => p,
        None => return,
    };

    let var_name = match pattern.utf8_text(source.as_bytes()) {
        Ok(n) => n.trim_start_matches("mut ").to_string(),
        Err(_) => return,
    };

    // Strategy 1: Explicit type annotation — `let x: Foo = ...`
    if let Some(type_node) = node.child_by_field_name("type")
        && let Ok(type_name) = type_node.utf8_text(source.as_bytes())
    {
        let clean = clean_type_name(type_name);
        if !clean.is_empty() {
            env.bind(scope, &var_name, &clean);
            return;
        }
    }

    // Strategy 2: Constructor binding — `let x = Foo::new(...)` or `let x = Foo { ... }`
    if let Some(value) = node.child_by_field_name("value")
        && let Some(type_name) = infer_type_from_value(&value, source, env, scope)
    {
        env.bind(scope, &var_name, &type_name);
    }
}

fn extract_params(params: &tree_sitter::Node, source: &str, scope: &str, env: &mut TypeEnv) {
    let mut cursor = params.walk();
    for child in params.children(&mut cursor) {
        if child.kind() == "parameter" {
            let name = child
                .child_by_field_name("pattern")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                .unwrap_or("");
            let type_name = child
                .child_by_field_name("type")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                .unwrap_or("");
            if !name.is_empty() && !type_name.is_empty() {
                let clean_name = name.trim_start_matches("mut ").trim_start_matches('&');
                env.bind(scope, clean_name, &clean_type_name(type_name));
            }
        }
    }
}

fn infer_type_from_value(
    value: &tree_sitter::Node,
    source: &str,
    env: &TypeEnv,
    scope: &str,
) -> Option<String> {
    let text = value.utf8_text(source.as_bytes()).ok()?;

    match value.kind() {
        // `Foo::new(...)` or `Foo::default()` → type is Foo
        "call_expression" => {
            if let Some(func) = value.child_by_field_name("function") {
                let func_text = func.utf8_text(source.as_bytes()).ok()?;
                // Pattern: Type::constructor(...)
                if let Some((type_part, method)) = func_text.rsplit_once("::")
                    && matches!(
                        method,
                        "new"
                            | "default"
                            | "create"
                            | "open"
                            | "build"
                            | "from"
                            | "with_capacity"
                            | "empty"
                    )
                {
                    // Strip any path prefix: crate::foo::Bar → Bar
                    let type_name = type_part.rsplit("::").next().unwrap_or(type_part);
                    return Some(type_name.to_string());
                }
                // Pattern: other_var.method() → look up other_var's type
                if let Some((receiver, _method)) = func_text.rsplit_once('.') {
                    let receiver = receiver.trim();
                    if let Some(type_name) = env.resolve_type(scope, receiver) {
                        return Some(type_name.to_string());
                    }
                }
            }
            None
        }
        // `Foo { field: value }` → type is Foo
        "struct_expression" => {
            if let Some(name) = value.child_by_field_name("name") {
                let type_name = name.utf8_text(source.as_bytes()).ok()?;
                return Some(type_name.to_string());
            }
            None
        }
        // Direct identifier reference → check if it's a known variable
        "identifier" => env.resolve_type(scope, text).map(String::from),
        // `vec![]`, `Vec::new()` etc
        "macro_invocation" => {
            if text.starts_with("vec!") {
                return Some("Vec".to_string());
            }
            None
        }
        _ => None,
    }
}

/// Clean a type name: strip references, lifetimes, generics for lookup.
/// `&'a mut HashMap<String, Vec<u8>>` → `HashMap`
/// `Arc<dyn Observer>` → `Arc`
/// `Box<dyn Middleware>` → `Box`
fn clean_type_name(raw: &str) -> String {
    let s = raw
        .trim()
        .trim_start_matches('&')
        .trim_start_matches("'_ ")
        .trim_start_matches("'a ")
        .trim_start_matches("mut ");

    // Strip generic parameters
    if let Some(idx) = s.find('<') {
        s[..idx].trim().to_string()
    } else {
        s.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_annotation() {
        let source = r#"
fn main() {
    let x: Agent = Agent::new();
    let y: &mut Observer = get_observer();
}
"#;
        let env = build_type_env_rust(source, "test.rs");
        assert_eq!(env.resolve_type("main", "x"), Some("Agent"));
        assert_eq!(env.resolve_type("main", "y"), Some("Observer"));
    }

    #[test]
    fn constructor_binding() {
        let source = r#"
fn setup() {
    let store = GraphStore::new();
    let config = AgentConfig::default();
    let agent = Agent { name: "test".into() };
}
"#;
        let env = build_type_env_rust(source, "test.rs");
        assert_eq!(env.resolve_type("setup", "store"), Some("GraphStore"));
        assert_eq!(env.resolve_type("setup", "config"), Some("AgentConfig"));
        assert_eq!(env.resolve_type("setup", "agent"), Some("Agent"));
    }

    #[test]
    fn self_in_impl() {
        let source = r#"
impl Agent {
    pub fn run(&self) {
        let observer = LogObserver::new();
    }
}
"#;
        let env = build_type_env_rust(source, "test.rs");
        assert_eq!(env.resolve_type("run", "self"), Some("Agent"));
        assert_eq!(env.resolve_type("run", "observer"), Some("LogObserver"));
    }

    #[test]
    fn parameter_types() {
        let source = r#"
fn process(config: &AgentConfig, name: String) {
    let x = 42;
}
"#;
        let env = build_type_env_rust(source, "test.rs");
        assert_eq!(env.resolve_type("process", "config"), Some("AgentConfig"));
        assert_eq!(env.resolve_type("process", "name"), Some("String"));
    }

    #[test]
    fn clean_types() {
        assert_eq!(
            clean_type_name("&'a mut HashMap<String, Vec<u8>>"),
            "HashMap"
        );
        assert_eq!(clean_type_name("Arc<dyn Observer>"), "Arc");
        assert_eq!(clean_type_name("Vec<String>"), "Vec");
        assert_eq!(clean_type_name("u32"), "u32");
    }
}
