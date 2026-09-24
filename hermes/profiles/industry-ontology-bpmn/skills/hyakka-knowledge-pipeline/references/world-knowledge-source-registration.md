# world-knowledge: entity/company source 登録

wiki に未登録の法人・団体（例: 株式会社カオナビ / Kaonavi）を world-knowledge に載せる手順。
登録 = `config/knowledge-ingest.edn` に従来型の `wikidata-<name>` source を 1 本足す。新規 corpus は作らない。

## 事前確認

1. 既存を引く: `curl -s -G https://wiki.yataverse.com/search --data-urlencode "q=<name>"` と
   日本語表記の両方。両方とも「検索結果（0件）」なら未登録。repo 側は
   `grep -rli '<name>' config/ src/` でも確認（0 なら確実に初登録）。
2. 適用 corpus は default の `world-knowledge`。`config/knowledge-ingest.edn` の `:corpus` と
   `:allowed-properties` を使う — 新しい property は足さず、既存の lexical/legal-name/website/
   located-in 等で足りる。

## Wikidata QID 特定

- search API はトークン 1 個ずつ試す。合成語（`Kaonavi カオナビ`）は 0 件になるが単数（`Kaonavi`）
  で 1 件引けた。ja と en の両方で試す。
  `curl -s -H 'Accept: application/json' "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<term>&language=en&format=json&limit=5"`
- 当てた QID の **P31 を必ず読む** — 誤 QID は 200 を返すだけなので、P31 で instance-of を確認する
  （Q4830453 business → `world/class/company`）。誤読を避けるため label（ja/en）と P856 も確認。
- 正しければ `Special:EntityData/Q<QID>.json` が 200 を返すことを確認（gate 相当）。

## LEI 軸の扱い

GLEIF の `filter[entity.legalName]` は**完全一致でなく部分一致** — 誤近傍語で huge な total が返る
（例: `KAONAVI CO.,LTD.` で 13 万人を返す）。判定は返った `data[]` の各 `legalName.name` が対象と
**文字列一致**するかで行う。transliteration 全 variant で 0 件の会社は「LEI 未登録」であり、wikidata
source が登録経路になる（LEI 軸で探し回らない）。

## 会社の一次公開面（IR / ウェブサイト / 規約）も足す

「IR やウェブサイトや利用規約も取り込んで」と言われたら、wikidata source に加えて会社自身の
公開開示ページを `:first-party-site` source として複数足す（corpus は同じ world-knowledge、新規
corpus 不要）。既存の company/ToS source（`contract-cloudflare` や `toyota-group-profile-page`）を
雛形に、`{:id "<org>-<page>" :kind :web-document :url ... :publisher "<Co>"
:source-classes [:first-party-site] :access "private" :interval-seconds 86400 :llm? true}`。

- **IR はメイン host の `/ir/` とは限らない**。上場日本企業は `corp.<domain>` 等の別サブドメインに
  IR 面を持つことがある。サイトの nav/footer から `href=[^\"]*ir[^\"]*` を grep して実 URL を求め、
  ページ本文を fetch して「404 Not Found」本文でないことを確認する（404 ページが 200 を返す
  WordPress 誤設定があり、status code だけでは判定できない — title/本文を見る）。
- **登録前に各 URL を実測**: HTTP 200・robots.txt が Disallow していない・本文に必要な content が
  ある。また GLEIF LEI 0 の会社は法人正本が公式開示ページなので、IR ニュース・電子公告（法定公告）・
  会社概要・沿革・経営陣・プライバシー/情報セキュリティ方針を一括登録するのが正しい。
- allowed-properties を広げない — legal-name / website / published-by / headline 等の既存語彙で足りる。
  上場 ticker は LLM 抽出に任ね、provenance のない ticker 主張を vocabulary に追加しない。

## config への追記と検証

- 既存 `wikidata-google` 等の block を雛形に、`{:id "wikidata-<name>" :kind :web-document
  :url "...EntityData/Q<QID>.json" :title ... :publisher "Wikidata" :license "CC0-1.0"
  :source-classes [:community-curated-permissive] :access "public" :interval-seconds 86400 :llm? true}`
  を追加。登録理由を `;;` コメントで 1 ブロック残す。
- config の妥当性ゲートは `clojure -M scripts/read_check.clj` → `SCANNED N / unreadable: 0` が pass。
  （superproject 外 worktree で出る `:paths external` deprecation warning は無害な既知ノイズ。）
- テストでは**総 source 数を pin する assertion は無く、`:kind` で filter するものだけ**。追加も
  `:web-document` はどの既存 kind-filter も壊さないので、全 `npm test` は回さなくてよい（main の
  npm test は別途落ちる既知 — その件は SKILL.md の罠節参照）。

## 着地（isolation 必須）

resident の共有 worktree（`~/.gftd/worktrees/app-hyakka-resident`、branch
`resident/knowledge-ingest`）は launchd が管理する稼働中の checkout で、独自の dirty file
（例: `test/hyakka/claims_fixture.cljc`）と既知の sync-main 409 を抱える。**source 登録を通す
作業はここでやらず、`origin/main` から切った一時 worktree で完結させる**:

```bash
cd ~/.gftd/worktrees/app-hyakka-resident
git diff -- config/knowledge-ingest.edn > /tmp/<name>-conf.diff   # 編集分を回収
WT=/tmp/app-hyakka-<name>-$$; git worktree add -b bot/<name>-source "$WT" origin/main
cd "$WT" && git apply /tmp/<name>-conf.diff                        # 再タイプせず apply
clojure -M scripts/read_check.clj                                  # gate
git add config/knowledge-ingest.edn && git commit -m "..."
git push -u origin bot/<name>-source
gh api repos/network-awai/app-hyakka/merges -f base=main -f head=bot/<name>-source \
  -f commit_message="..."                                          # サーバ側マージ
```

- **`gh api .../merges` は成功しても `.merged:null` を返す** — このフラグで判定しない。
  着地確認は `git fetch origin` 後 `git show origin/main:config/knowledge-ingest.edn | grep <id>` が
  1 件出ること、および `git merge-base --is-ancestor <head-sha> origin/main` で true。
- 後片付け: 一時 worktree `--force` remove、`git branch -D`、`git push origin --delete`。resident
  resident worktree 側の大元編集は main 着地後 `git checkout -- config/knowledge-ingest.edn` で戻す（
  二重適用を防ぐ）。resident の他 dirty file（claims_fixture.cljc 等）には手を出さない。

### landing/cleanup の tool 罠

- **複合コマンド（`&&`・`;`・heredoc・複数行まとめ）は terminal が拒否（hardline blocklist）に
  かかることがある**。着地系は 1 コマンド 1 tool call に分割し、特に worktree add / apply / commit /
  push / merges は各 1 本で回す。複数命令を 1 回で通そうとするな。
- **自分が `cd` している worktree を `git worktree remove --force` すると、その後の tool call の
  cwd が無効になり exit 126 で止まる**。remove 後は cwd が消えた worktree を指さないよう、以降の
  tool call に `workdir` を明示する（外側の `~/.gftd/worktrees/app-hyakka-resident` 等）。
- diff は共有 worktree で `git diff -- config/... > /tmp/x.diff` して回収 → 一時 worktree で
  `git apply` する方式が冪等で安全（手で再タイプしない）。

## 報告

- 対象 corpus / 追加 datoms 数 / 台帳 seq / 異常の有無。
- source 追加直後は**「追加 datoms: 0」**と正直に報告 — datom は次の resident tick が EntityData を
  fetch ・ LLM extractor を通して初めて生える。seq は着地 merge SHA。
