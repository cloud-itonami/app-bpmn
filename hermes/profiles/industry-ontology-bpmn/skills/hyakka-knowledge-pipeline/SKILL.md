---
name: hyakka-knowledge-pipeline
description: "Use when reporting app-hyakka knowledge pipeline status."
---

# hyakka-knowledge-pipeline

wiki.yataverse.com の知識基盤（repo network-awai/app-hyakka）の稼働測定・状態報告手順。
canonical host は wiki.yataverse.com（2026-09-14 移行、ADR 2609141707）。移行期間中は wiki.kotobase.net も
同一 Worker が serv する（両 custom domain）。
itonami の役割（情報収集 corpus を kotobase datom plane へ流す）を実測で確認するときに使う。
オーナーが「wiki.yataverse.com の情報収集の状況と オントロジーの分析登録の状況は」の形で
聞くのが定番 — この skill の手順がその答えになる。

## いつ読むか

オーナーが hyakka / wiki.yataverse.com / オントロジーの状況を尋ねたとき、または
app-hyakka の deploy / ingest が壊れた報告に遭遇したとき。

**wiki.yataverse.com の検索エンジン適合（SEO / GSC 登録 / クロール可否）を測る・直す
ときは `itonami-cloud-site` の `references/seo-indexing-diagnosis.md` を参照** —
被リンク診断・Cloudflare MCP 経由の Google 検証 TXT 設定・GSC 確認の一連がそこにある。

## 測定手順（この順で、実測だけを報告する）

1. resident 稼働確認。常駐は launchd `com.network-awai.hyakka-knowledge-ingest`
   （hyakka-knowledge-resident.cljs、3600s 間隔）: `launchctl list | grep -i hyakka`。
   ラベルが PID 付きなら稼働中。
2. run ログ: `tail /tmp/hyakka-knowledge-ingest.log`。パイプラインは
   `sync-main(pre) → ingest → upload-raw(B2) → publish-git(catalog+commit+merge)
   → sync-main(post) → publish-kotobase(ledgers) → deploy-public(test+build+wrangler)`。
   各段の ✓/✗ を読み、`step timings` で何秒・どれが FAILED だったかを見る。
3. checkout: `~/.gftd/worktrees/app-hyakka-resident`。`git log --oneline -5`、
   `git status -s`。**superproject の共有 `orgs/` checkout ではなく必ず worktree を測る**。
4. ledger / receipts 件数:
   - ledger ファイル: `find knowledge/ledger -name '*.datoms.edn' | wc -l`
   - 実 datom 行（空 seed を除く）: `find knowledge/ledger -name '*.datoms.edn' -exec cat {} + | grep -cE '{'`
   - receipts: `find knowledge/receipts -type f | wc -l`
   - 分析台账: `knowledge/analysis/gp-relation.edn`（head に run 番号と角度）
5. ontology: `config/knowledge-ingest.edn` の `:allowed-properties` 固有件数
   （`grep -oE 'prop/[a-z0-9./-]+' | sort -u | wc -l`）と `src/hyakka/corpus/registry.cljc`
   の corpus 名。**config と registry は test suite が機械で突き合わす** — 片方にしか
   無い property は受理時に 1 fact ずつ拒否される。
6. 報告書式（オーナーが期待する形）:
   `対象 corpus / 追加 datoms 数 / 台帳 seq / 異常の有無`。seq は publish-git merge SHA、
   異常は FAILED 段の理由を具体的に。

## write 側 — shoseki 書籍 frontier への追加

wiki に載っていない書籍（例: アナトミートレイン）を「記録して繋げる」には、新規 corpus を作らず
`shoseki`（Wikidata-book 面）の `:qids` に検証済み QID を 1 つ足す。手順・QID 検証・テスト経路・罠は
`references/shoseki-book-seeding.md`。実測の肝: **追加した QID の P31 を必ず読み、instance-of（literary work）
を確認する**（誤 QID は 200 を返す）。datom は次の resident tick が流すので、seed 追加時点では
「追加 datoms: 0」と正直に報告する。

## write 側 — 政府・統計ソース登録

wiki に未登録の主要統計局（米・英・中・日等）を world-knowledge に載せるには、`config/knowledge-ingest.edn`
へ `wikidata-gov-source-<country>` source を追加する。詳細手順と罠は `references/government-statistics-sources.md`。
実測の肝:
- **source class は `:authoritative-registry`**（:community-curated-permissive ではない）
- source 追加後 **`npm run catalog` で catalog.cljc を再生成**（手動追加不可）
- **resident branch なら origin/main を base にして PR 作成**（`git fetch origin main && git reset --hard origin/main`）
- **merge conflict 時は `npm run catalog` で autoresolve**、marker 編集禁止

## write 側 — 分析文書の wiki 着地

「調べて wiki に整理して」の形の依頼（調査 → markdown ドラフト → wiki 着地）の手順。
draft はそのまま貼れず、出典つき source + claim に分解する。手順は
`references/analysis-article-landing.md`。実測の肝: fan-out 子 agent の schema fail でも
transcript/kernel 成果物から内容は救える。publish-kotobase が滞留している間は
「着地済み」と言わない。

同じく「XX 調達候補を 50〜100 社整理して」の形（企業・ベンダー目録）は `references/analysis-article-landing.md` の
「ベンダー目録/企業リスト系の着地」節 + `templates/seed_catalogue.cljs` を参照 — analysis 文書と型が違い、
`sources.json → アーカイブ → seed スクリプト → ledger → PR` の素材ベース経路で着地する。

## itonami-anatomy-fascia bot（2026-09-06 作成・basho で稼働中）

帳 fasmly 集 corpus bot の 1 体。日次 06:12 (cron d2b7078dfea2) に shoseki
（Wikidata-book）frontier へ筋膜・解剖 book の QID を 1 件ずつ追加提案する。

- **profile**: `itonami-anatomy-fascia`（SOUL.md + yakuwari.edn problems 0 +
  `scripts/anatomy_fascia_evidence.cljs`）。worktree
  `~/.gftd/worktrees/itonami-anatomy-fascia-shoseki`。
- **model は basho**: config.yaml に `basho` provider（base_url
  api.murakumo.cloud, key_env: MURAKUMO_API_TOKEN, default awai-network/basho）を
  持ち、cron model=awai-network/basho。basho は HF backended GLM-5.3-Flash
  （provider-order huggingface,modal,openrouter）。認証は fleet 共有 mk1
  （MURAKUMO_API_TOKEN）— basho は mk1/shared/ｃｕ
  biscuit/passkey/cacao を identity rail に持つ。
- **bot は merge まで自動完走**: PR #611 (Q26971972 hardcover) + PR #618
  (Q129350773 paperback) を両方 merge した。QID 検証は Special:EntityData を
  fetch して book-classes（P31: Q7725634 literary work / Q3331189 edition / 他 6
  種）を upcheck してから提案する。
- **罠**: cron prompt に「git reset/checkout -- で worktree を同期」を書くと
  unattended deny になる。非破壊同期（fetch + switch -c origin/main）を明記する。

## 多言語 UI（ja/en 人手辞書 + 100+ 機械翻訳 locale）

wiki.yataverse.com の chrome の構造:

- `src/hyakka/i18n.cljc` — 人手執筆の `:ja` / `:en` 辞書（正本）。**既定言語は en**（オーナー指示）。
- `src/hyakka/i18n_locales.cljs` — **GENERATED**。機械翻訳 locale（**173 言語 × 全 chrome キー、計 175 locale**、最終 merge `d9609296` deploy `06774e53`）。手編集禁止。
- `all-dict` = 人手 2 言語 + 生成 locale（**文字列タグを keywordize して merge** — 生成ファイルのキーは文字列、`t` の lookup は keyword。これがずれると html lang=de で本文 ja になる）。
- データ（claim/label）は取り込み言語のまま。訳を置かない（翻訳は record であり正本ではない、ADR-2809031900）。
- 未収録は **sa（サンスクリット）/ udm（ウドムルト）のみ**（2 モデル × 複数回で完全セットが出ず）。en フォールバック。不在は coverage 事実。

**locale を追加する手順**（state は resumable、`~/.hermes/profiles/itonami/cache/hyakka-i18n/`）:

1. `python3 mt.py`（OpenRouter key は murakumo-tok profile の .env から。失敗 locale は state から自動再試行）
2. origin/main から fresh worktree を切り `python3 gen_locales.py <wt>/src/hyakka/i18n_locales.cljs` で再生成
3. worker test の locale assert（`locales-beyond-ja-en-resolve-and-render`）を通す
4. commit → push → `gh api .../merges` サーバ側マージ → worktree 掃除 → deploy

**罠**:

- **reasoning 付きモデルは max_tokens を reasoning で食って content が空になる**（finish=length 多発）。
  完全セット翻訳には non-reasoning モデル（deepseek-v4-flash 級）を使う。低資源言語は 2 モデル交互
  リトライでも完全 170 行が出ないことがある（retry3.py）——無理に埋めず en フォールバックに任せる。
- **翻訳 state を /tmp に置かない**。Hermes カーネルの /tmp は sandbox 隔離されて terminal bg プロセスから見えない。profile cache に置く。
- **ja/en 辞書のキー集合は機械で突き合せる**（正規表現で :ja/:en ブロックのキーを抽出して diff）。手で足すと必ず片側欠けする。
- **ja 文字列を (t :key) 化するとき、置換前後の括弧数を数える** — 文字列→式の置換は delimiter を変えがちで、丸括弧 1 個差が compile ERROR になる。`git diff -U0` の per-hunk net bracket/paren delta 計算が最速。
- **catalog.cljc を再生成して commit/deploy diff に混ぜない** — `npm run catalog` は ledger 最新 shard を取り込み、「:corpus/* entity 無し」系テスト失敗を +1 作る。i18n だけの変更なら catalog/claims_fixture の再生成 diff は revert する（deploy bundle は build 時に再生成されるので問題ない）。
- **回帰判定は「同条件で FAIL 集合差分 0」で行う** — main 自身が 既存 failure を多数抱えており、件数ではなく集合で比べる。条件は 3 test file（land_registry / realestate_investment / world_research）を .off 退避 + 両側 compile し直し。
- ⚠ **git stash による pristine 比較は効かない**: tracked file の mv が stash で巻き戻り、out/node-tests.js も stale になる。pristine は /tmp に worktree を切って作る。deps.edn の `../../kotoba-lang/*` は symlink で解決（**2 段深さ配置**: env/worktrees/app-hyakka 形にしないと ../.. が /tmp 直上を向く）。i18n-cid は superproject 側から symlink。
- **辞書だけの assert では不十分。rendered page を assert する** — 辞書が locale を持っていても描画がフォールバックする事故を、`binding [worker/*lang* "de"]` で home-page を render して H1 を見る形で pin する。
- ja 文字列を assert していた既存テストは「en 既定 assert + `(binding [worker/*lang* "ja"] ...)` の ja assert」の 2 本に更新する — 「辞書がある」ではなく「既定が en」を検証する。
- **lang-switch には request path が要る**: `*current-path*` dynamic を routes の全 `(binding [*lang* ...])` 8 箇所で一緒に bind する。1 箇所でも漏れると既定 "/" に静かに落ちる。
- 言語メニューは nav inline に 100+ リンクを並べず `<details>` スクロールリスト（CSS は hyakka-lang-menu）+ hreflang alternates（en/ja/x-default）。

## write 側 — tabi-mikake travel source の着地

tabi-mikake（travel metasearch bot、repo network-awai/app-tabi-mikake）の cron `tabi-fare-scout` が /tmp/tabi-source-proposal.edn に書いた source 提案を app-hyakka に着地させるとき:

1. 提案ファイルを読み、両 URL を自分で curl して HTTP 200 + 実データ shape を確認する（bot は propose まで、着地は operator/gate）。
2. gate を origin/main から切った fresh worktree で回す: `nbb --classpath "src:scripts" scripts/verify_source_proposal.cljs --proposal /tmp/tabi-source-proposal.edn` → CHECKED N / REJECTED 0 を見てから config を編集する。
3. `config/knowledge-ingest.edn` の `:sources` 末尾に提案どおりの `:web-document` entry を足す（kebab id / url / title / publisher / license / :source-classes / :access / :interval-seconds / :llm?）。
4. EDN reader で全 config を読み直し、source 総数・ID 重複 0・追加分の :kind/:corpus/:license を nbb で確認してから commit。
5. branch push → `gh api .../merges` サーバ側マージ → branch/worktree 掃除 → resident worktree を --ff-only 追従。

共有 worktree（app-hyakka-resident）には他 bot の未 commit WIP が常時ある。触らず、origin/main 直読み（`git show origin/main:<path>`）+ /tmp の fresh worktree で作業する。

## write 側 — content-addressed index の republish（ledger index plane）

ledger が進んだら content-addressed index を rebuild → publish → pin 着地の 3 段で更新する。全部 origin/main の fresh /tmp worktree で行う:

1. **build**: `nbb --classpath src:scripts scripts/build_index.cljs` — ledger/snapshot から 4 index (item/search/edge/year) を leaf ブロック（384KB バイト上限）に chunk し、wall clock を含まない root block を出す。生成物: `.index-build/blocks/`（gitignore）+ `index-root.edn` + `src/hyakka/ledger_index.cljc`（生成物、手編集禁止）。root CID は同一 ledger 状態なら**毎回同一**に収束する（build が wall clock を hash に含めない設計）。`--verify` でローカル block の CID 再計算照合。
2. **publish**: `nbb --classpath src:scripts scripts/publish_index.cljs` — R2 bucket `kotobase-graph-database-production` に `ipld/<cid>` で並列 upload（**R2-backed、bitswap 無し、CID が capability**）。publish 前に PUBLIC gateway（`https://<cid>.ipfs.kotobase.net/`）へ HEAD を打って既 serve 分を飛ばす — bucket に在っても serve されない block は「未完了」として扱う設計。`--verify` は全 CID を gateway から fetch-back して byte 比較する（**これが完了条件。build の verify だけでは serve を証明しない**）。完了行: `SCANNED 37/37 mismatched=0` + `every block is served and byte-identical`。
3. **pin 着地**: 生成された `src/hyakka/ledger_index.cljc`（root-cid/corpora/counts/catalog-sha256）を commit → branch push → `gh api .../merges` → main 着地。Worker はこの 1 行を読むだけで新 index に切り替わる（**IPNS は使わない** — mutable naming 無し、更新は root-cid swap。旧 CID は hold され続ける）。
4. **live 確認**: 新 root が gateway で HTTP 200、`wiki.yataverse.com/health` の `catalog-id` が build 出力の `catalog-sha256` と一致することを見る。

publish が `already served: N to upload: 0` から始まっても正常 — 別 agent / 前回 run が同一 ledger 状態の build を出していた場合、同じ CID に収束する。判定は最後の --verify の byte 比較で行う。

## Kotoba migration workflow

Clojure → Kotoba 移行の詳細手順は `references/kotoba-migration-workflow.md` を参照。

## write 側 — 外部 agent からの匿名投稿レーン（agents.md / llms.txt 経路）

wiki.yataverse.com は **app-hyakka worker が Custom Domain で serve する**（`worker/wrangler.jsonc` の routes、`worker/js/main.js` が bundle）。投稿 API `POST /api/v1/submissions` もこの worker にある。grok-bots（`itonami-grok-bots` worker、bots.itonami.cloud）は backend/MCP 連携側で、投稿の serve 元ではない — 401 の原因を grok-bots 側に探さない。

**診断手順（401 "Anonymous submission is unavailable at this edge" を見たら）**:

1. `curl https://wiki.yataverse.com/agents.md` を先に読む — 接続状態（匿名受付の可否・レート制限）がそこに宣言されている。仕様と edge の乖離をまず書き出す。
2. 実装が入っている branch を特定する。エラー文字列がローカル bundle に無いとき、checkout が古いだけでなく**実装が main 未 merge の feature branch にある**ことがある: app-hyakka で `git fetch origin && git merge --ff-only origin/main` してから bundle を再検索し、それでも無ければ `git log --all --grep=anon -i`（例: `origin/codex/pseudonymous-agent-submissions`）。feature branch から deploy したら**暫定 deploy** として扱い、PR merge → main 着地までを完了条件にする（deploy だけで終えない）。
3. 匿名レーンの secret は **`HYAKKA_ANONYMOUS_GATEWAY_SECRET`**（>=32 bytes、app-hyakka と grok-bots の両 worker で共有。grok-bots 側 wrangler.itonami-bots.jsonc のコメントに記載）。未設定/不一致だと匿名受付が 401 になる設計。kagi から取得、無ければ生成して両 worker に `wrangler secret put`。
4. deploy は rebuild が前提: bundle（main.js）が生成物なので、source を直しただけでは届かない。build → wrangler deploy（origin/main 包含 checkout から）。rebuild 手順（この順）:
   1. `nbb --classpath "src:scripts:~/.gitlibs/libs/io.github.kotoba-lang/text/<sha>/src" scripts/generate_catalog.cljs` — catalog script が `kotoba.lang.text` を要求するが deps.edn の git dep は nbb classpath に乗らない。gitlibs cache の path を直接足す（sha は deps.edn の `:git/sha` から読む）
   2. `nbb --classpath "src:scripts:<text src>:../../kotoba-lang/io-ipld/src:../../kotoba-lang/io-multiformats/src:../../kotoba-lang/org-ietf-cbor/src:../../kotoba-lang/org-nist-sha2/src:../../kotoba-lang/dev-protobuf/src" scripts/build_index.cljs`（index:publish が要る時だけ publish も）
   3. `npx shadow-cljs release worker`（初回は approval prompt が出ることがある。Java の sun.misc.Unsafe WARNING は無害）
   4. deploy 前に `grep -c "Anonymous submission" worker/js/main.js` で bundle に目的の経路が入ったことを確認する — **build 通過＝bundle 更新ではない**。grep 0 なら bundle が stale。
5. **検証は両方向**: 匿名 POST → 202（proof_id 受領。202 だけでは公開確定ではない — GET で extraction/publish status を追う）、無効 Bearer → 401 が残ること。形式検査も確認（content 無し → 400）。
6. 別レーンの注意: Python urllib 等の一部 client が Cloudflare Browser Integrity Check で 403 になることがある（agents.md が予告）。これは投稿 gate とは別件で zone 側設定 — コードを直さない。

## 罠（これらを踏んで時間を溶かさない）

- **`.kotoba` を nbb が require できない（2026-09-08 実測）**: ただし正攻法の修復は **e9a3087b（0 insertions の純リネーム commit）を `git revert` して `.cljc` に戻す** こと（2026-09-08 着地、merge 36de9bd9）。リネーム commit は中身を 1 バイトも変えていないので revert が常に正解。amu `check` も reader-conditional を reject する。「deterministic 移植」回避は claim digest の単体検証専用とし、namespace 復旧には使わない。
- **salvage/union merge が config source を落としたら、origin commit から当該 `{:id ...}` ブロックを文字列アサーション付きで抜き出して復元する**（2026-09-08 実績: gleif/edgar/fudosan/pdok/apicarto）。復元時は `:source-classes`（複数形）と `:corpus` をテスト期待に揃え、namespace 側 `registry/corpora` + `properties` union + `connector-source-classes` まで一括で足す（1 つ欠けると policy test の evidence floor が赤）。
- **ledger shard ファイルは 1 ファイル 1 read-string**。複数 entity を書くなら `[ {...} {...} ]` の 1 ベクタに包む（裸 map を 1 行ずつ書くと 2 個目以降が黙って捨てられ、`mapcat` は map を entry 列に展開するので無関係な map が 2 要素に裂ける）。
- **パス名を誤入力する** - `com-junkasaki` と `com-junkawasaki` の混同で `cd` 失敗を繰り返さない。コマンド実行前に `pwd` で確認。

**`npm test` が落ちる → deploy-public が毎回 FAILED** になるのは、main に committed
   された `.cljs` の括弧不整合（`read_check.clj` が `UNREADABLE … Unmatched delimiter: )`
   と報告）が上流。git diff が空なら **ローカル改変でなく main 由来** — deploy 前に
   committed 破損を直すのが修復で、worktree の WIP ではない。worker.cljs は
   wiki.yataverse.com の公開 read surface そのもの。
- **`publish-kotobase` が FAILED でも `publish-git` が ✓ なら、datom は git に
   着地しているが kotobase datom plane に未到達**（`Kotobase pending ledgers = N`
   が増え続ける）。「git に入った」と「kotobase plane に入った」は別物 — itonami の
   契約は後者まで流すことなので、この滞りは「成功」でなく未達として報告する。
- ledger ファイルは **append-only の shard（各1行）**。実件数を見るのにファイル行数を
   そのまま使わず、`{` を含む行（= 実 datom）を grep で数える（空 seed が混じる）。
- 複数 profile（hyakka / hyakka-corpus / scout 群）が同一 repo を git worktree で共有し、
  同名 job や同時刻の source/ontology-scout が git 衝突を量産する。hyakka 系の
  失敗を見たら並行 git worktree 競合を疑う。
- **sync-main 409 の修復実績（2026-09-06）**: clean worktree で merge → catalog.cljc の
  conflict は `npm run catalog` 再生成で解消（marker 編集禁止どおり）。deps.edn の
  `../../kotoba-lang/*` source paths は superproject 外の worktree では解決しないので、
  一時 dir に west checkout への symlink を作って deps.edn を書き換えて test 通過を確認
  （deps.edn は commit しない）。push 後 `gh api .../merges` でサーバ側マージ、
  resident worktree は `--ff-only` で追従。
- **main 自身の npm test は落ちる（merge 起因ではない）**: land_registry_test（run 1〜3）が
  `config/knowledge-ingest.edn` から `:kind :pdok-kadastrale-perceel` 等の source を filter
  するが、config union/salvage merge が config 半分を落として以来 0 件 → `first nil` →
  "source must declare :subject-id and :label" で throw。修復は config への run 1〜3 source
  entries 復帰（5226881 が gleif の同型欠損を修復した先例）。
- **サーバ側マージの `gh: Requires authentication (HTTP 401)` は一過性のことがある** —
  すぐ `gh auth status` と `gh api repos/... --jq .full_name` で手動確認し、
  credential が生きていれば merge API をそのまま再試行する。401 を credential 消失と
  読んで再設定に走ると時間を溶かす。
- **merge 再試行の前に resident branch の包含を確認する**:
  `gh api .../compare/main...resident/knowledge-ingest --jq '{ahead_by, behind_by}'` で
  `ahead_by: 0` なら resident tick は既に main に着地済み — 再マージは不要で、
  resident worktree を `--ff-only` で main に追従させるだけでよい。
- **`publish-git` で catalog 衝突が起きたら**（`src/hyakka/catalog.cljc` merge conflict）:
  1. `npm run catalog` で catalog を再生成（`src/generate_catalog.cljs` を実行）
  2. `git add src/hyakka/catalog.cljc` で staging
  3. `git commit` で rebase 継続
  4. push 後 PR merge
- **B2 認証がない場合は pipeline が B2 昇降で止まる** (`upload-raw`, `publish-git` が FAILED)。
  1. `tail /tmp/hyakka-knowledge-ingest.log` で `b2-creds: 解決できない項目: key-id, app-key`
     という行を検索。2. 1Password でアイテム `hyakka-b2`（type: パスワード、user: key-id、pass: app-key）
     を作成/更新。3. 次の resident tick で自動的に再生。4. 手動 fire する場合は
     `hermes cron run <job_id> --profile hyakka`。
- **resident worktree が origin/main から乖離したらリセットする**（並行 git が衝突した場合）。
  `cd ~/.gftd/worktrees/app-hyakka-resident && git reset --hard origin/main && git clean -fd`。
  直後に `git status` で `Your branch and 'origin/main' have diverged` が消えたことを確認。

- **PR merge 後の resident worktree 同期**: PR が merge されたら、resident worktree を `git reset --hard origin/main` で同期。`git status` で `Your branch is up to date with 'origin/main'` を確認。
