## shoseki 書籍 frontier への book QID 追加（write 側）

wiki.yataverse.com の「書籍」corpus（`hyakka.corpus.shoseki`、repo network-awai/app-hyakka）に
1 冊を積む手順。入口は config の `:qids` 列で、**手で正当な QID を 1 つ足す**ことだけが growth。
Wikidata の 2 つの列挙面（/w/api.php 検索と SPARQL）は robots で禁じられているので frontier は
自動では伸びず、`coverage` が「空であることを空として表示する」。

### 手順（この順で）

1. QID を検索: `curl "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<title>&language=en&format=json"`。
2. **P31 を実測検証する。検索結果の label を信じない。** Special:EntityData JSON を fetch し
   `claims.P31[].mainsnak.datavalue.value['numeric-id']` が **`wikidata-book/book-classes` の
   どれか**（Q7725634 literary work / Q571 book / Q47461344 written work / **Q3331189
   edition** / Q8261 novel / Q49084 short story / Q1279564 collection / Q25379 play）に
   入ることを読む（= `wb/book?` が通る）。**誤 QID は 200 を返して立派な entity を返す**
   — ある QID が著者を指すつもりで book 検索に引っかかったが P31=Q5（human）だった実測あり。
   だから prose/検索ではなく instance-of を読む。
3. 著者 QID（P50）も検証（ID→labels が期待する人物か）。**edition 版（P31=Q3331189）は
   corpus の book-classes に含まれるので seed に足してよい** — coverage は "ISBN は work に付かず
   edition に付く" と述べ、edition を seed すれば ISBN が入る、と述べる。
4. config/knowledge-ingest.edn に新しい `wikidata-books-N` を追記:
   `{:id "wikidata-books-N" :kind :wikidata-book :corpus "shoseki" :interval-seconds 21600
   :max-references 8 :qids ["Q…"]}`。既存 N と排他（重複 QID を足さない）。
5. **fresh worktree を origin/main から切る。** resident worktree は共有・dirty で topic branch 上にあり、
   直接書かない。`git -C <resident-worktree> worktree add -b bot/... <path> origin/main`。
6. 検証（config のみの変更ならここで十分）: 順に nbb で直接アサート:
   `qids` が全部 `Q\d+` / `:corpus=shoseki` / `:kind=:wikidata-book` /
   `source-classes-for` が `shoseki` policy の `:allowed-source-classes` に全部入る。
   CLI に config-conformance テストが持つ不変条件を全部写した形。EDN が読めることも
   `cljs.reader` + `fs/readFileSync` で確認。
7. push → `gh pr create` → `gh pr merge --merge --delete-branch` →
   `git fetch origin main` して QID が `origin/main:config/...` に居ることを読戻し確認。

### 罠

- **新しい source を足しても datom は即出ない。** 実 datom は次回 resident ingest tick
  （hyakka profile, 3600s）が回って初めて generate される。報告は「追加 datoms: 0（seed のみ）」+
  次の tick を正しく述べる。live wiki 検索が 0 件でも**正常**。
- **fresh worktree には `node_modules` が無い**ので `npm test`（read-check + shadow-cljs compile）
  は走らない。config のみの変更なら nbb 直接アサートで通したと報告し、フル suite green とは**言わない**。
  何を検証したか明示する。
- fresh worktree の .git は file（worktree 参照）なので `git worktree add` は resident worktree
  が入ってる repo 内から実行する（superproject ルートから cd してきても repo の外では落ちる）。
- コミットの author は worktree に共有された hyakka@kotobase.net のまま — 変更しない。