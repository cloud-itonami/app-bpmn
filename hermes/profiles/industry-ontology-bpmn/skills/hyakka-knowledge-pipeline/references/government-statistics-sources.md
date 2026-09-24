# Government statistics source registration

## When to add

When the hyakka knowledge base lacks coverage of major national/international statistics bureaus. Typical targets:
- US: Census Bureau, BLS, SEC EDGAR
- UK: Office for National Statistics (ONS)
- China: National Bureau of Statistics (NBS)
- Japan: e-Stat (e-Stat)

## Procedure

1. **Add to config**
   Edit `config/knowledge-ingest.edn` and append source entries at the end of the `:sources` array:
   ```clojure
   {:id "wikidata-gov-source-us-census" :kind :web-document :corpus "world-knowledge"
     :url "https://www.census.gov/"
     :title "US Census Bureau" :publisher "US Census Bureau"
     :source-classes [:authoritative-registry]
     :access "public" :interval-seconds 86400 :llm? true}
   ```

2. **Regenerate catalog**
   ```bash
   npm run catalog
   ```
   This updates `src/hyakka/catalog.cljc` with the new source count and claim totals.

3. **Commit and PR**
   ```bash
   git add config/knowledge-ingest.edn src/hyakka/catalog.cljc
   git commit -m "add: government statistics sources (..."
   gh pr create --base main
   ```

4. **Merge**
   After PR approval, merge into main. The resident tick will begin collecting from these sources.

## Pitfalls

- **B2 credentials missing**: If `upload-raw(B2)` fails with `b2-creds: 解決できない項目: key-id, app-key`, add credentials to 1Password item `hyakka-b2`.
- **Catalog not regenerated**: Forgetting `npm run catalog` means the source change won't be reflected in the compiled catalog.cljc.
- **Resident branch diverges from main**: Before creating PR, ensure your resident branch is based on origin/main. If you see `Your branch and 'origin/main' have diverged`, reset with `git fetch origin main && git reset --hard origin/main` then reapply your changes.
- **Catalog merge conflict**: If `src/hyakka/catalog.cljc` has a merge conflict after rebasing, run `npm run catalog` again to regenerate it cleanly. Do not manually edit conflict markers.
- **Concurrent worktree lock**: Other hyakka profiles may be using the same worktree. If `git status` shows conflicts, reset with `git reset --hard origin/main && git clean -fd` then reapply changes.
- **Wrong source class**: Use `:authoritative-registry` for government sources, not `:community-curated-permissive`.

## Example additions

See the `wikidata-gov-source-*` entries in `config/knowledge-ingest.edn` for the canonical format.
