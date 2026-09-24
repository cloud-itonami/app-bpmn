#!/usr/bin/env nbb
;; Catalog/bench-vendor seeding — generalized from scripts/seed_pos_research.cljs.
;; Copy to scripts/seed_<name>.cljs and replace every <NAME>/<name> placeholder.
;; Reads research/<dir>/sources.json, verifies each archived byte (sha256 + literal
;; evidence), emits source+item+claim datoms for the dataset hub and each member.
(ns seed-data-catalogue
  (:require [hyakka.claim :as claim] [hyakka.ingest :as ingest]
            [clojure.string :as str] ["node:fs" :as fs]
            ["node:path" :as path] ["node:crypto" :as crypto]))

;; --- per-run configuration (edit these) ----------------------------------------------
(def base "research/<name>-YYYY-MM-DD")          ; research dir holding sources.json + README.md
(def hub "world/dataset/<name>-YYYY-MM-DD")      ; dataset hub item id
(def actor "did:ingest:hyakka-<name>-research")  ; asserting actor
(def conn "<name>-YYYY-MM-DD")                   ; claim qualifier connector
(def out-date "YYYY-MM-DD")                     ; ledger/receipt date dir (same as run date)
(def label-en "Global data database — 2026 procurement-candidate catalogue")
(def label-ja "世界のデータベンダー調達候補目録（2026）")
(def prop-root "data-vendor")                    ; prop/<root>-member, prop/<root>-note
(def min-count 50) (def max-count 100)
;; -------------------------------------------------------------------------------------

(def archive (or (aget js/process.env "HYAKKA_ARCHIVE_DIR")
                 (str (aget js/process.env "HOME") "/.gftd/hyakka-archive")))
(def rows (js->clj (js/JSON.parse (fs/readFileSync (str base "/sources.json") "utf8")) :keywordize-keys true))
(def instant (last (sort (map :retrievedAt rows))))

(defn hash-bytes [b] (-> (crypto/createHash "sha256") (.update b) (.digest "hex")))
(defn plain [s]
  (-> s (str/replace #"(?i)<(script|style)\b[^>]*>[\s\S]*?</\1>" " ")
      (str/replace #"<[^>]+>" " ") (str/replace #"&nbsp;|&#160;" " ")
      (str/replace "&amp;" "&") (str/replace #"\s+" " ") str/trim))
(defn slug [s]
  (-> (str/lower-case s) (str/replace #"[^a-z0-9]+" "-") (str/replace #"(^-+|-+$)" "")))
(defn id-of [r] (str "world/company/" prop-root "-" (slug (:id r))))

(def props
  [{:db/id (str "prop/" prop-root "-member") :prop/id (str "prop/" prop-root "-member")
    :prop/label "supplier research entry" :prop/label-ja "調達候補調査対象"
    :prop/datatype "item" :prop/domain "world/class/dataset" :prop/range "world/class/company"}
   {:db/id (str "prop/" prop-root "-note") :prop/id (str "prop/" prop-root "-note")
    :prop/label "research observation" :prop/label-ja "調査記録"
    :prop/datatype "string" :prop/domain "world/class/dataset world/class/company"}])
(def allowed #{(str "prop/" prop-root "-note") (str "prop/" prop-root "-member")})
(def receipts (atom []))

(defn build-row [r]
  (let [raw (fs/readFileSync (path/join archive (:sha256 r)))
        _ (assert (= (:sha256 r) (hash-bytes raw)) (str "archive mismatch " (:id r)))
        text (plain (.toString raw "utf8"))
        _ (assert (str/includes? text (:evidence r)) (str "nonliteral evidence " (:id r)))
        src (claim/source {:url (:url r) :title (str (:name r) " — product source")
                           :publisher (:name r) :retrieved-at (:retrievedAt r)
                           :archived-cid (str "sha256:" (:sha256 r)) :access "private"
                           :source-class :first-party-site :corpus "world-knowledge"})
        subject {:id (id-of r) :kind :company :label (:name r) :label-ja (:name r)
                 :aliases ["調達候補調査2026" (:category r)]}
        context {:source-id (:source/id src) :source-body text :corpus "world-knowledge"
                 :asserted-by actor :asserted-at (:retrievedAt r) :structured? false
                 :allowed-properties allowed :extractor "source-grounded-editorial-review"
                 :model "GPT-6" :source-sha256 (:sha256 r) :connector conn}
        facts (ingest/admit-fact {:subject subject
                                  :property (str "prop/" prop-root "-note")
                                  :value (str "公式製品記載: " (:productMention r)
                                              "。調達候補分類: " (:category r)
                                              "。法人・OEM・子会社の区別は未照合。")
                                  :evidence (:evidence r) :confidence 1} context)
        member (claim/claim {:subject hub :property (str "prop/" prop-root "-member")
                             :value-item (id-of r) :source (:source/id src)
                             :asserted-by actor :asserted-at (:retrievedAt r)
                             :corpus "world-knowledge" :qualifiers {:evidence (:evidence r)
                               :relation-basis "curated inclusion from official product listing"}})]
    (swap! receipts conj {:sha256 (:sha256 r) :bytes (:bytes r)
                          :archive-relative-path (:sha256 r)
                          :object-key (str "hyakka/raw/sha256/" (:sha256 r))})
    (concat [src] facts [member])))

(def row-entities (vec (mapcat build-row rows)))
(def report (fs/readFileSync (str base "/README.md")))
(def report-hash (hash-bytes report))
(fs/writeFileSync (path/join archive report-hash) report)
(swap! receipts conj {:sha256 report-hash :bytes (.-length report) :archive-relative-path report-hash
                      :object-key (str "hyakka/raw/sha256/" report-hash)})
(def report-source
  (claim/source {:url (str "https://github.com/network-awai/app-hyakka/blob/main/" base "/README.md")
                 :title "調達候補調査の方法と限界" :publisher "Hyakka research" :retrieved-at instant
                 :archived-cid (str "sha256:" report-hash) :access "private"
                 :source-class :owner-verified :corpus "world-knowledge"}))
(def hub-item
  (claim/item {:id hub :label label-en :label-ja label-ja
               :description "公式データ/製品ページの一次資料。法人・OEM・子会社の区別と出所照合は未完了。"
               :class "world/class/dataset" :corpus "world-knowledge"}))
(defn note [text] (claim/claim {:subject hub :property (str "prop/" prop-root "-note")
                              :value text :source (:source/id report-source)
                              :asserted-by actor :asserted-at instant :corpus "world-knowledge"}))
(def categories (sort (set (map :category rows))))
(def all-entities
  (vec (concat props [hub-item report-source]
               [(note (str "調達候補 " (count rows) " 者を公式ページの一次資料だけで整理。カテゴリ: "
                           (str/join " / " categories) "。法人・親子・OEM・子会社の区別と、"
                           "データ出所・ライセンス・精度・更新頻度の照合は未完了。"))
                (note "未確認/未取得の取得失敗は非対応・不存在を意味しない。URL は fetch 時に 200/リダイレクトを確認済み。")]
               row-entities)))

(assert (<= min-count (count rows) max-count))
(assert (= (count rows) (count (set (map :id rows)))))
(def out (str "knowledge/ledger/" out-date "/" out-date "T23-59-00-000Z-" prop-root "s.datoms.edn"))
(fs/mkdirSync (path/dirname out) #js {:recursive true})
(fs/writeFileSync out (str (pr-str all-entities) "\n"))
(def receipt-out (str "knowledge/receipts/" out-date "/" out-date "T23-59-00-000Z-" prop-root "s.edn"))
(fs/mkdirSync (path/dirname receipt-out) #js {:recursive true})
(fs/writeFileSync receipt-out (str (pr-str {:run/id (str prop-root "s-" out-date) :run/raw @receipts
                                            :run/entities (count all-entities)
                                            :run/source-count (count rows)
                                            :run/status "source-admitted-awaiting-publication"}) "\n"))
(println "literal evidence and SHA256 verified; entities=" (count all-entities) "sources=" (count rows))