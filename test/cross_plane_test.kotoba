#!/usr/bin/env nbb
;; cross_plane_test.cljs — the three planes' declarative surfaces, checked
;; against each other.
;;
;; ## Why this lives at the repo root and not inside a plane
;;
;; README.md opens by saying the most important fact about this repo is that
;; its three planes "do not agree with each other". Every statement of that
;; kind is currently prose: nothing reads `kotoba/src/index.ts` and
;; `xrpc-adapter/src/index.ts` together and notices when they stop lining up.
;; The facts checked here are *between* planes, so they belong to none of
;; them — `kotoba/test/bpmn.test.ts` cannot see the adapter, and the adapter
;; has no test at all.
;;
;; These checks read source text and do not execute the TypeScript. That is
;; not a limitation being worked around: a route table, an export list, an
;; NSID base and a `case` label are textual facts, and the disagreements
;; between them are visible in the text. Executing either plane would prove
;; less, not more — the kotoba suite runs against a mock substrate and cannot
;; observe the adapter or the appview at all.
;;
;; It is also cheap on purpose. `docs/operator-quickstart.md` §3 measured the
;; kotoba install at 27m21s on this workstation (the git dependencies build
;; from source), and the appview needs D1/R2/Hyperdrive bindings that no
;; local run has. This file needs nbb and the checkout.
;;
;; ## What "pinned" means here
;;
;; Some of these record agreement (routes ↔ exports) and some record
;; *disagreement* (the two NSID bases, the two JSON vocabularies). Both are
;; pinned the same way: as the observed value. A check going red therefore
;; means "the world moved", not necessarily "someone broke it" — including
;; the good case where a split gets repaired. The message says which.
;;
;; ## Exit codes are three-valued
;;
;;   0  every check passed
;;   1  a check failed — the report names which fact moved
;;   2  REFUSED — a file or anchor this reads is missing, so nothing was
;;      measured. A checker that cannot see its input must not answer "clean";
;;      that is the failure mode CLAUDE.md's six questions are about.
;;
;; Run: nbb test/cross_plane_test.cljs

(ns cross-plane-test
  (:require ["node:fs" :as fs]
            ["node:path" :as path]
            [clojure.set :as set]
            [clojure.string :as str]))

(def root
  "Repo root = the directory holding this test/ directory."
  (path/resolve (path/join (path/dirname (or js/__filename "test/cross_plane_test.cljs")) "..")))

;; ── refusal ────────────────────────────────────────────────────────────────
;;
;; Collected rather than thrown, so one run reports every reason it could not
;; measure instead of only the first.

(def refusals (atom []))
(defn- refuse! [why] (swap! refusals conj why) nil)

(defn- read-source
  "Source text, or a refusal. Returns nil when absent — every caller treats
   nil as 'not measured', never as 'empty'."
  [rel]
  (let [p (path/join root rel)]
    (if-not (fs/existsSync p)
      (refuse! (str "missing source: " rel))
      (let [s (str (fs/readFileSync p "utf8"))]
        (if (str/blank? s)
          (refuse! (str "empty source: " rel))
          s)))))

(defn- between
  "The slice of `s` strictly between the first `open` and the following
   `close`. Refuses when either anchor is absent or out of order — an
   anchor that has been renamed must not silently widen the region to the
   whole file, which is how a scoped scan turns into a file-wide one."
  [s rel open close]
  (when s
    (let [i (str/index-of s open)
          j (when i (str/index-of s close i))]
      (cond
        (nil? i) (refuse! (str "anchor not found in " rel ": " (pr-str open)))
        (nil? j) (refuse! (str "closing anchor not found in " rel ": " (pr-str close)))
        :else (subs s (+ i (count open)) j)))))

(defn- matches
  "Every capture group 1 of `re` in `s`, de-duplicated, as a set. Refuses when
   fewer than `floor` distinct hits: a regex that stopped matching returns the
   empty set, and the empty set agrees with every subset assertion below."
  [s label floor re]
  (when s
    (let [found (into #{} (map second) (re-seq re s))]
      (if (< (count found) floor)
        (refuse! (str "scanned " (count found) " " label
                      " (floor " floor ") — the extractor stopped matching"))
        found))))

;; ── checks ──────────────────────────────────────────────────────────────────

(def results (atom []))

(defn- check [nm ok? msg]
  (swap! results conj {:name nm :ok? (boolean ok?) :msg msg}))

(defn- check= [nm expected actual what]
  (check nm (= expected actual)
         (if (= expected actual)
           (str what " = " (pr-str (if (set? actual) (vec (sort actual)) actual)))
           (str what " moved"
                "\n      expected: " (pr-str (if (set? expected) (vec (sort expected)) expected))
                "\n      actual:   " (pr-str (if (set? actual) (vec (sort actual)) actual))
                (when (and (set? expected) (set? actual))
                  (str "\n      gone:     " (pr-str (vec (sort (set/difference expected actual))))
                       "\n      new:      " (pr-str (vec (sort (set/difference actual expected))))))))))

;; ── plane 1: the kotoba slice ───────────────────────────────────────────────

(def kotoba-index (read-source "kotoba/src/index.ts"))

(def kotoba-exports
  "Value exports re-exported from the three implementation modules. The
   `export type { … } from \"./types.js\"` block and the rkey/DID helper block
   are deliberately excluded: they are not callable operations, and the
   adapter does not route them."
  (matches kotoba-index "kotoba export blocks" 3
           #"export\s*\{([^}]*)\}\s*from\s*\"\./(?:process|instance|activity)\.js\""))

(def kotoba-ops
  (when kotoba-exports
    (into #{} (comp (mapcat #(str/split % #","))
                    (map str/trim)
                    (remove str/blank?))
          kotoba-exports)))

;; ── plane 2: the XRPC adapter ───────────────────────────────────────────────

(def adapter (read-source "xrpc-adapter/src/index.ts"))

(def adapter-base
  (when adapter
    (or (second (re-find #"const\s+NSID_BASE\s*=\s*\"([^\"]+)\"" adapter))
        (refuse! "xrpc-adapter/src/index.ts: NSID_BASE not found"))))

(def adapter-routes
  (matches adapter "adapter routes" 10 #"\[`\$\{NSID_BASE\}\.(\w+)`\]"))

;; ── plane 3: the appview actor ──────────────────────────────────────────────

(def appview-dir "appview/etzhayyim-wasm-bpmn-bx7qm9p4")
(def app-ts (read-source (str appview-dir "/src/app.ts")))
(def manifest-txt (read-source (str appview-dir "/kotodama.jsonld")))

(def appview-commands
  (matches app-ts "appview commands" 8 #"sdk\.app\.command\(nsid\(\"([^\"]+)\"\)"))

(def appview-base
  (when appview-commands
    (let [bases (into #{} (map #(str/join "." (butlast (str/split % #"\.")))) appview-commands)]
      (if (= 1 (count bases))
        (first bases)
        (refuse! (str "appview commands span " (count bases) " NSID bases: " (pr-str bases)))))))

;; The JSON authoring subset each compiler accepts. Scoped to the switch that
;; emits elements — not the whole file — so that an unrelated switch elsewhere
;; does not silently enlarge the answer.
(def appview-step-types
  (matches (between app-ts "app.ts" "const elements: string[] = [];" "// Emit all sequenceFlow elements")
           "appview step types" 8 #"case \"(\w+)\""))

(def kotoba-process (read-source "kotoba/src/process.ts"))

(def kotoba-step-types
  (matches (between kotoba-process "process.ts" "export async function compileJsonToXml" "export async function compileBpmn")
           "kotoba step types" 3 #"flowType === \"(\w+)\""))

;; ── the facts ───────────────────────────────────────────────────────────────

(def expected-ops
  #{"deployProcess" "listProcesses" "validateXml" "compileJsonToXml" "compileBpmn"
    "analyzeProcess" "startInstance" "getInstanceState" "listInstances"
    "signalInstance" "cancelInstance" "executePipeline" "getActivityLog"})

(def expected-appview-only
  "The three operations the appview never grew. `executePipeline` and
   `analyzeProcess` and `compileBpmn` exist only on the migrated side."
  #{"compileBpmn" "analyzeProcess" "executePipeline"})

(def expected-appview-steps
  #{"startEvent" "endEvent" "errorEndEvent" "serviceTask" "userTask"
    "exclusiveGateway" "parallelGateway" "timerIntermediateCatchEvent"
    "messageIntermediateCatchEvent" "sequenceFlow"})

(def expected-kotoba-steps #{"start" "end" "gateway"})

(defn- run! []
  ;; --- agreement: the adapter is a faithful projection of the kotoba slice
  (when (and kotoba-ops adapter-routes)
    (check= "kotoba-exports-are-the-thirteen-operations" expected-ops kotoba-ops
            "kotoba/src/index.ts value exports")
    (check "xrpc-routes-cover-every-kotoba-export"
           (empty? (set/difference kotoba-ops adapter-routes))
           (let [d (set/difference kotoba-ops adapter-routes)]
             (if (empty? d)
               (str "all " (count kotoba-ops) " exports are routed")
               (str "exported but unroutable over XRPC: " (pr-str (vec (sort d)))))))
    (check "xrpc-routes-add-nothing-kotoba-does-not-export"
           (empty? (set/difference adapter-routes kotoba-ops))
           (let [d (set/difference adapter-routes kotoba-ops)]
             (if (empty? d)
               (str "all " (count adapter-routes) " routes resolve to an export")
               (str "routed but not exported: " (pr-str (vec (sort d))))))))

  ;; --- disagreement: the two planes write to different namespaces
  (when (and adapter-base appview-base)
    (check= "migrated-plane-nsid-base-is-com-etzhayyim-bpmn"
            "com.etzhayyim.bpmn" adapter-base "xrpc-adapter NSID_BASE")
    (check= "appview-plane-nsid-base-is-com-etzhayyim-apps-bpmn"
            "com.etzhayyim.apps.bpmn" appview-base "appview command NSID base")
    (check "the-two-planes-still-do-not-share-a-namespace"
           (not= adapter-base appview-base)
           (if (= adapter-base appview-base)
             (str "the split README.md describes is GONE — both planes now use "
                  adapter-base ". That is repair, not regression: update README.md "
                  "and this check together.")
             (str "records written by the appview (" appview-base ".*) are still "
                  "invisible to readers of the migrated plane (" adapter-base ".*)"))))

  ;; --- the appview implements a strict subset
  (when (and appview-commands kotoba-ops appview-base)
    (let [locals (into #{} (map #(last (str/split % #"\."))) appview-commands)]
      (check "appview-commands-are-a-subset-of-kotoba-exports"
             (empty? (set/difference locals kotoba-ops))
             (let [d (set/difference locals kotoba-ops)]
               (if (empty? d)
                 (str (count locals) " appview commands all name a kotoba export")
                 (str "appview commands with no kotoba counterpart: " (pr-str (vec (sort d)))))))
      (check= "operations-the-appview-never-implemented"
              expected-appview-only (set/difference kotoba-ops locals)
              "kotoba operations absent from the appview")))

  ;; --- the two JSON compilers accept disjoint vocabularies
  (when (and appview-step-types kotoba-step-types)
    (check= "appview-json-subset-is-the-observed-step-types"
            expected-appview-steps appview-step-types
            "compileJsonToXml step types accepted by the appview")
    (check= "kotoba-json-subset-is-the-observed-branches"
            expected-kotoba-steps kotoba-step-types
            "compileJsonToXml flow types branched on by the kotoba slice")
    ;; The consequence, stated as its own check because it is the reason the
    ;; two sets above are worth pinning: the kotoba compiler has an unguarded
    ;; `else` that emits <bpmn2:task/>. Every appview step type therefore
    ;; compiles there — into the wrong element, with status "compiled".
    (check "appview-step-types-compile-to-plain-task-on-the-kotoba-slice"
           (empty? (set/intersection appview-step-types kotoba-step-types))
           (let [shared (set/intersection appview-step-types kotoba-step-types)]
             (if (empty? shared)
               (str "none of the " (count appview-step-types) " appview step types is "
                    "branched on by the kotoba compiler; all of them fall to its "
                    "default branch and are emitted as <bpmn2:task/> with status "
                    "\"compiled\" — a silently wrong process, not a rejection")
               (str "the vocabularies now overlap on " (pr-str (vec (sort shared)))
                    " — re-read both compilers before trusting this record")))))

  ;; --- the actor manifest against the tree it describes
  (when manifest-txt
    (let [component (second (re-find #"\"component\"\s*:\s*\{\s*\"path\"\s*:\s*\"([^\"]+)\"" manifest-txt))]
      (if-not component
        (refuse! "kotodama.jsonld: component.path not found")
        (check "actor-manifest-component-path-exists-in-the-tree"
               (fs/existsSync (path/join root appview-dir component))
               (str "kotodama.jsonld component.path = " (pr-str component)
                    (when-not (fs/existsSync (path/join root appview-dir component))
                      " — but no such file under " appview-dir))))))

  (when (and manifest-txt appview-base)
    (let [collections (->> (re-seq #"\"(com\.etzhayyim\.apps\.bpmn\.[^\"]+)\"" manifest-txt)
                           (map second) set)]
      (check "manifest-trigger-collections-use-the-appview-namespace"
             (seq collections)
             (str (count collections) " subscribeRepos collections under " appview-base
                  (when (empty? collections)
                    " — none found, so this check measured nothing"))))))

;; ── report ──────────────────────────────────────────────────────────────────

(run!)

(let [rs @results
      failed (remove :ok? rs)
      refused @refusals]
  (println "── app-bpmn cross-plane checks ──")
  (println (str "SCANNED\tkotoba-exports=" (count (or kotoba-ops []))
                " xrpc-routes=" (count (or adapter-routes []))
                " appview-commands=" (count (or appview-commands []))
                " appview-steps=" (count (or appview-step-types []))
                " kotoba-steps=" (count (or kotoba-step-types []))))
  (doseq [{:keys [name ok? msg]} rs]
    (println (str (if ok? "  ok   " "  FAIL ") name)
             (str "\n         " msg)))
  (cond
    (seq refused)
    (do (println)
        (println "REFUSED — nothing was measured for:")
        (doseq [r refused] (println (str "  · " r)))
        (println (str "Refusing to report a pass on " (count rs) " checks that did run;"
                      " a checker blind to its input must not answer \"clean\"."))
        (js/process.exit 2))

    (seq failed)
    (do (println)
        (println (str "cross-plane: " (count failed) " of " (count rs) " checks FAILED"))
        (js/process.exit 1))

    :else
    (do (println)
        (println (str "cross-plane: OK (" (count rs) " checks)"))
        (js/process.exit 0))))
