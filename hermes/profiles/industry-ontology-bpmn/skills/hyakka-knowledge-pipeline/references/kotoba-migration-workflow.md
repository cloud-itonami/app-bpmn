# Kotoba migration workflow

## When to use

When migrating Clojure files (.clj/.cljc/.cljs) to Kotoba (.kotoba) in a repository. Typical scenarios:
- Porting decision cores (route matching, simple predicates)
- Porting business logic
- Porting infrastructure code (oracle bridges)

## Procedure

### 1. Create the .kotoba file

Copy the `.clj/.cljc` file and convert to `.kotoba`:

```clojure
;; Original .clj/.cljc
(ns cloud.itonami.app.health)
(defn health? [path] (= path "/health"))

;; Converted .kotoba (same namespace, same logic)
(ns cloud.itonami.app.health)
(defn health? [path] (= path "/health"))
```

**For simple predicates:** No changes needed. Kotoba supports the same syntax.

**For complex code:**
- Replace `:require` with direct imports
- Use `if` instead of `cond` for simple conditionals
- Replace `=` with `=` for basic equality
- Add type annotations where needed (`:i64`, `:bool`)

### 2. Remove the old .clj/.cljc file

After confirming the .kotoba file works:

```bash
rm path/to/old_file.clj
rm path/to/old_file.cljc
```

### 3. Update progress tracking

Update the `kotoba-migration-progress.md` file:

```markdown
| Date | Files | Lines |
|------|-------|-------|
| 2026-09-07 | 3 | 120 |
```

### 4. Commit and PR

```bash
git add path/to/new_file.kotoba path/to/old_file.clj path/to/progress.md
git commit -m "migrate: health.clj → health.kotoba"
gh pr create --base main
```

## Pitfalls

- **Namespace changes**: Keep the original namespace. Don't rename it to `kotoba.foo` unless explicitly requested.
- **Complex logic**: If the .clj file uses advanced Clojure features (protocols, multi-methods, core.async), don't migrate yet. Flag it as `Phase 3` in the progress file.
- **Testing**: Kotoba files should have the same test coverage as the original. Check tests exist before removing .clj.
- **Incremental migration**: Migrate in small batches (5-10 files per PR) to make review easier.
- **Don't leave orphaned .clj files**: If you create a .kotoba file, remove the .clj file in the same commit.

## Migration phases

### Phase 1: Simple decision cores
- Route matching
- Simple predicates
- Boolean checks

### Phase 2: Medium business logic
- Data transformations
- Basic algorithms
- Simple business rules

### Phase 3: Complex integration
- Protocol implementations
- Multi-method dispatch
- Async code
- JVM-specific features

## Reference

For detailed Kotoba syntax rules, see:
- `amu/docs/native-aot-baseline.md`
- `kotoba-lang/lang/stdlib/core.kotoba`