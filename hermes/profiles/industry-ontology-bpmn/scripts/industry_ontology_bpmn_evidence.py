#!/usr/bin/env python3
"""
industry_ontology_bpmn_evidence.py
全産業（ISIC 21 大分類 A〜U、467 ブループリント）の
1. オントロジー（wiki.yataverse.com / hyakka）カバレッジ
2. BPMN 業務プロセス定義（app-bpmn / proposals）カバレッジ
3. 業務改善・成熟度（Governor・kotoba-native slice）進捗
を read-only で横断測定し、次の未整備フロンティア産業を 1 件特定する。
"""
import os
import sys
import glob

SUPERPROJECT = "~/github/com-junkawasaki"
HYAKKA_CONFIG = os.path.expanduser("~/.gftd/worktrees/app-hyakka-resident/config/knowledge-ingest.edn")
BPMN_PROPOSALS = os.path.expanduser("~/.hermes/profiles/industry-ontology-bpmn/workspace/proposals")

# ISIC 21 Sections (A - U)
ISIC_SECTIONS = [
    ("A", "Agriculture, forestry and fishing", ["0111", "0112", "0113", "0311", "0312"]),
    ("B", "Mining and quarrying", ["0510", "0520", "0710", "0810", "0910"]),
    ("C", "Manufacturing", ["1010", "1020", "1811", "1812", "2910"]),
    ("D", "Electricity, gas, steam and air conditioning", ["3510", "3520", "3530"]),
    ("E", "Water supply; sewerage, waste management", ["3600", "3700", "3811", "3821"]),
    ("F", "Construction", ["4100", "4210", "4220", "4311", "4321"]),
    ("G", "Wholesale and retail trade", ["4510", "4520", "4610", "4711", "4721"]),
    ("H", "Transportation and storage", ["4911", "4921", "4922", "4923", "5210", "5221"]),
    ("I", "Accommodation and food service activities", ["5510", "5520", "5610", "5621"]),
    ("J", "Information and communication", ["5811", "5820", "6110", "6201", "6311"]),
    ("K", "Financial and insurance activities", ["6411", "6419", "6492", "6511", "6611"]),
    ("L", "Real estate activities", ["6810", "6820"]),
    ("M", "Professional, scientific and technical activities", ["6910", "6920", "7010", "7110"]),
    ("N", "Administrative and support service activities", ["7710", "7810", "8010", "8110"]),
    ("O", "Public administration and defence", ["8411", "8412", "8421", "8422"]),
    ("P", "Education", ["8510", "8521", "8530", "8541"]),
    ("Q", "Human health and social work activities", ["8610", "8620", "8710", "8810"]),
    ("R", "Arts, entertainment and recreation", ["9000", "9101", "9200", "9311"]),
    ("S", "Other service activities", ["9411", "9511", "9521", "9601"]),
    ("T", "Activities of households as employers", ["9700", "9810", "9820"]),
    ("U", "Activities of extraterritorial organizations", ["9900"])
]

def measure():
    # 1. Hyakka sources count
    hyakka_sources = 0
    if os.path.exists(HYAKKA_CONFIG):
        try:
            with open(HYAKKA_CONFIG, "r", encoding="utf-8") as f:
                content = f.read()
                hyakka_sources = content.count("{:id ")
        except Exception as e:
            pass

    # 2. ISIC / ISCO blueprint repos
    isic_dirs = glob.glob(os.path.join(SUPERPROJECT, "orgs/cloud-itonami/cloud-itonami-isic-*"))
    isco_dirs = glob.glob(os.path.join(SUPERPROJECT, "orgs/cloud-itonami/cloud-itonami-isco-*"))

    # 3. Existing BPMN proposals count
    bpmn_files = glob.glob(os.path.join(BPMN_PROPOSALS, "*.bpmn.edn"))
    onto_files = glob.glob(os.path.join(BPMN_PROPOSALS, "*.proposal.edn"))

    # 4. Check section coverage
    # Find next section lacking BPMN proposals
    covered_sections = set()
    for f in bpmn_files:
        basename = os.path.basename(f)
        for sec, name, codes in ISIC_SECTIONS:
            for c in codes:
                if c in basename or f"isic-{c}" in basename or f"section-{sec.lower()}" in basename:
                    covered_sections.add(sec)

    frontier_section = None
    for sec, name, codes in ISIC_SECTIONS:
        if sec not in covered_sections:
            frontier_section = (sec, name, codes[0])
            break

    print(f"SCANNED\tisic={len(isic_dirs)}\tisco={len(isco_dirs)}\thyakka_sources={hyakka_sources}\tbpmn_proposals={len(bpmn_files)}\tonto_proposals={len(onto_files)}")
    print(f"MEASURE\tisic_blueprints\t{len(isic_dirs)}")
    print(f"MEASURE\tisco_blueprints\t{len(isco_dirs)}")
    print(f"MEASURE\thyakka_sources_count\t{hyakka_sources}")
    print(f"MEASURE\tbpmn_proposals_count\t{len(bpmn_files)}")
    print(f"MEASURE\tonto_proposals_count\t{len(onto_files)}")

    if frontier_section:
        sec, name, code = frontier_section
        print(f"FRONTIER\tsection={sec}\tname={name}\tprimary_code=ISIC-{code}\tstatus=need_analysis_and_bpmn")
    else:
        print("FRONTIER\tall_21_sections_covered\tstatus=deepen_subdivisions")

if __name__ == "__main__":
    measure()
