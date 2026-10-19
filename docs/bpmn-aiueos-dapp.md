# app-bpmn — itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-19）。正本はこの文書。
追跡: Linear JUN-119（親 JUN-116「itonami dapp 整備プログラム」）。

## 位置づけ

app-bpmn は itonami（dapp）の app bundle であり、独立 dapp ではない
（ADR 0007 / 0008）。層の全体像は network-awai-apex の
`docs/dapp-architecture-map.md` が正本。

## このスライスで実装したもの

| 層 | 実体 | 状態 |
|---|---|---|
| 判断コア guest | `aiueos/bpmn_process.cljk` — sequence flow 集合の判定（検証ビット 4 種 / start・end event 候補数 / 経路到達）。`:effects #{}` | **実装済み・実測** |
| アプリ記述子 | `aiueos/bpmn.edn`（notes.edn 形、`:aiueos/kind :app`） | **実装済み** |
| appview adapter | `bpmn_frontend/process.cljk`（map API）+ parity fixture | **実装済み・実測** |
| wasm 産物 | `aiueos/bpmn_process.wasm` + provenance | **実装済み** |

## 実測（2026-10-19、このスライスで実行したもの）

- `amu check aiueos/bpmn_process.cljk` → `:ok true`, `:effects #{}`。
- `amu test aiueos/bpmn_process.cljk` → **21/21 passed**
  （test 7 本 × targets `[:jvm-kir :js :wasm]`）。
- `amu compile --target wasm32-browser` → wasm（MVP module）+ provenance。
- kbb `test/run_tests.cljk` → 3 tests / 8 assertions / 0 failures。

## 実行 host と ABI

guest は vector パラメータを使うため KIR v4 / `kotoba.typed/externref-v1`
（typed-value ABI）。実行 host は契約どおり **kototama-browser-host-v1**
（amu selfhost、`amu/runtime/browser-host.mjs` の typed ホスト）。aiueos の
Chicory kernel ホストは typed ホストを持たない（kernel 経路での名前付き
拒否は kotoba-lang/aiueos の itonami-dapp-bundle-test に pin 済み）。
L2（admission → selfhost 実行）の証拠パターンは同 repo の
itonami-dapp-selfhost-test。本 bundle の同テストへの組み込みは次のスライス。

## 未実装境界（このスライスでは触れていない）

- **aiueos app catalog への載せ**（session/grant の launcher 経路）。
- **分散状態**: `bpmn_definitions_current` は SQL graph（中央）にあり、
  dapp 化の移行在庫。`mon`（entry 規則 = flow 判定）/ `ito`（署名履歴）/
  `nuno`（同期）への割り当ては未設計。
- **publish / generate**（murakumo LLM）は effect を伴い guest の外。
- **path-exists? の予算**: 再帰予算 2*|E|+2 で打ち切る（cycle 停止のため）。
  超過は 0 を返す — 長大な迂回経路の検出は第 2 スライスで visited 集合
  版に置き換える。
- XML の BPMN パースは未実装（入力は判定済み flow 集合の想定）。

## 次の一手

1. aiueos の L2 テストに本 bundle を組み込み（selfhost 実行の証行の証拠を拡張）。
2. visited 集合による正確な到達判定。
3. `mon`/`ito`/`nuno` の割り当て確定（ADR 0005 の線）。
