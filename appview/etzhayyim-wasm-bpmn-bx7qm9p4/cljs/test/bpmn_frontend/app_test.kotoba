(ns bpmn-frontend.app-test
  (:require [cljs.test :refer [deftest is testing]]
            [re-frame.core :as rf]
            [re-frame.db :as rf-db]
            [bpmn-frontend.app :as app]))

(deftest init-db-sets-expected-defaults
  (testing ":init-db populates app-db with the scaffold's name + tagline"
    (rf/dispatch-sync [:init-db])
    (is (= app/default-db @rf-db/app-db))
    (is (= "etzhayyim-wasm-bpmn-bx7qm9p4" @(rf/subscribe [:app/name])))
    (is (= "ClojureScript entry scaffold after Svelte migration."
           @(rf/subscribe [:app/tagline])))))

(deftest subs-project-their-own-field-only
  (testing "each sub reads exactly its own key out of app-db"
    (reset! rf-db/app-db {:name "x" :tagline "y" :unrelated-key :ignored})
    (is (= "x" @(rf/subscribe [:app/name])))
    (is (= "y" @(rf/subscribe [:app/tagline])))))
