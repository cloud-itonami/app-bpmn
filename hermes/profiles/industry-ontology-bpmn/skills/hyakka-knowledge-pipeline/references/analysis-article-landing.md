# analysis-article 着地: 分析文書を wiki に載せる

「X について調べて wiki に整理して」の形の依頼（network 分析、市場整理、制度比較等）は、
調査ドラフトをそのまま wiki に貼れない。hyakka は「出典のない主張は入れない」が正本で、
**LLM の要約文は claim になれない**。調査 → ドラフト → wiki 着地は 3 段階の別作業で、
それぞれ手順が違う。

## 手順の全体像

1. **調査**（delegate fan-out 可）: 出典 URL 付きの実測事実を集める。数値は必ず出典ごと
   に記録。schema 指定の子 agent は最終回答が (+NNNN chars) で切れて schema fail する
   ことがある — 失敗しても transcript / kernel cwd の成果物ファイルを回収すれば
   内容は救える。**スキーマ fail しても salvage できるので、大量 fan-out を恐れない**。
2. **ドラフト**: 調査結果を markdown 分析に整形する。ただしこれは wiki の claim ではない —
   「claim に分解する前の下書き」として扱う。/tmp に置くと消えるので worktree 内に置く。
3. **wiki 着地**: ドラフトの主張を「出典つき source + claim」に分解する。

## ベンダー目録/企業リスト系の着地（素材ベース seed 経路）

「XX データベンダー・候補企業を 50〜100 社整理して wiki に記録して」の形の依頼は、
既存の `scripts/seed_*.cljs`（先例: `seed_pos_research.cljs`、87 社）を流用して着地できる。
sources.json → アーカイブ取得 → seed スクリプト → ledger `.datoms.edn` + receipt → PR
の順。analysis 文書と型が違う（個別企業 × カテゴリの一次資料リストであって解釈文では
ない）ので、この節が正しい手順。

1. **カテゴリ別 fan-out で候補を集める**（1 並行 1 カテゴリ）。各社: `name` / `url`
   (データ製品ページ, 実際に開いて 404 でないことを確認) / `category`(enum) /
   `note`(売るデータの種類 1 文)。output_schema で category を enum に縛ると、後段の
   機械パースと seed の `:category` 欄が壊れない。
2. **アーカイブへ取得**: 各 url を fetch して `~/.gftd/hyakka-archive/` に保存 → sha256 を
   sources.json の行に記録。seed スクリプトが `sha256` 照合 + evidence の逐語 inclusion
   を assert するので、fetch 失敗は「非対応/不存在」でなく「未取得」として sources.json の
   note に残す（取得失敗を「無い」と読まない）。
3. **seed スクリプトを流用**: `scripts/seed_pos_research.cljs` を写して props 名・hub id・
   actor・`<名>-*` prefix を置換する。settle 対象: props (`prop/<x>-member` item 型 +
   `prop/<x>-note` string 型) と ontology.kotoba への登録、ledger 日付 dir
   (`knowledge/ledger/YYYY-MM-DD/`)、hub `world/dataset/<名>-YYYY-MM-DD`、件数 assert
   （50〜100 のように範囲で）。雛形は `templates/seed_catalogue.cljs`。
4. **着地は worktree 隔離 + PR**（isolation 必須 — 共有 resident worktree は launchd 管理で
   dirty を抱える）。`origin/main` から一時 worktree を切り、seed を回して ledger を生成し、
   commit → push → `gh api .../merges`（サーバ側マージ。`.merged:null` は成功でも返るので
   `git show origin/main:<file> | grep <id>` で着地確認）。後片付けは worktree remove +
   branch -D。
5. **報告書式**: 対象 corpus / 追加 datoms 数 / 台帳 seq / 異常の有無。seed 実行直後は
   「追加 datoms: 0（次 tick で kotobase plane に流れる）」と正直に報告 — git に入ったのと
   kotobase plane に入ったのは別物。

## 着地の型（ドラフト → source/claim）

- 主張の裏の一次資料（公式文書・regulator press release・chain 上の実測記事）を
  `config/knowledge-ingest.edn` の source として登録する — 既存 corpus に収まる形にする
  （例: blockchain network の主張 → `chain` corpus の `:chain-rpc` か、
  sanctions 面の OFAC press release、stablecoin 規制 → world-knowledge の web-document）。
  手順は `references/world-knowledge-source-registration.md` と同型。
- 分析者の解釈文は `knowledge/analysis/gp-relation.edn` の `prop/gp-analysis` 型の
  analysis 台帳に載せる先例がある — subject item に紐づく analysis claim として書き、
  「fact about the shape of the stored graph, not any assessment of …」という境界文を
  冒頭に置くのが既存フォーマット。
- **数値は LLM 要約に任せない**: 上場廃止日・凍結金額等の数値は「その数値を出した
  一次資料」を source として持ち、evidence が archive bytes の逐語部分文字列になる。
- 測れていないものは「未測定」と明記 — corpus に source が無いことを「不在の証明」にしない。

## 罠

- **ドラフトの数値は出典 URL と 1:1 で結ぶ**。URL がない bullet は着地時に claim 化できず
  全部捨てることになる — 調査段階で URL を要求しておく（fan-out prompt に出典必須を書く）。
- **publish-kotobase が滞留していると着地が見えない**: `git に入った` と
  `kotobase plane に入った` は別物（SKILL.md 罠節参照）。分析を着地させた場合は
  wiki.yataverse.com の item page が実際に出るまで「着地済み」と言わない。
