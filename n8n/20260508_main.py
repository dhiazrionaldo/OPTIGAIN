"""
OptiGain AI Product Mix Simulator — v8.4.2
Revamp dari v8.4.1

Perubahan utama:
  - FIX: run_optimization_engine() — kandidat swap (dari mapping_lookup maupun
         family substitution fallback) sekarang difilter hanya ke produk yang
         PERNAH dibeli customer kapanpun (ada di raw_products / histori customer).
         Produk yang belum pernah dibeli tidak akan muncul di projected.
  - RETAINED: Semua fitur v8.4.1:
      · build_ledger_from_snapshot() — baseline ledger dari last month qty
        × harga standar product_master (via gp).
      · Fallback ke build_product_ledger() (historical avg) untuk customer baru
        tanpa data last month.
      · Semua fix v8.4.0 (visited_pairs, src_unit_price, submit-all-poll-parallel).
  - GUARANTEED: Output field names tidak berubah sama sekali.

Business logic yang disepakati:
  current   = last month actuals (qty × harga product_master)
  projected = rekomendasi bulan depan
  target swap: HANYA produk yang pernah dibeli customer kapanpun (raw_products),
               BUKAN produk baru yang belum pernah dibeli sama sekali.
"""

import os
import asyncio
import math
import time
import re
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, List, Dict, Optional, Set
import anthropic

app = FastAPI(title="OptiGain AI Product Mix Simulator", version="8.4.2")

TARGET_GM_PCT        = 9.0
SUPABASE_CHUNK       = 50
PARETO_MIN_QTY_RATIO = 0.5

# ── AI Config ─────────────────────────────────────────────────────────────────
AI_MODEL                  = "claude-sonnet-4-6"
AI_MAX_TOKENS             = 300
AI_TEMPERATURE            = 0.3
AI_BATCH_CHUNK_SIZE       = 50
AI_BATCH_SUBMIT_DELAY_SEC = 0
AI_BATCH_POLL_SEC         = 5
AI_BATCH_POLL_JITTER_SEC  = 2
AI_BATCH_MAX_WAIT         = 300
AI_BACKOFF_BASE_SEC       = 5.0
AI_BACKOFF_MAX_SEC        = 60.0
AI_MAX_RETRIES            = 5

# ── System Prompt ─────────────────────────────────────────────────────────────
AI_SYSTEM_CONTEXT = (
    "Kamu adalah sales advisor spesialis kaca. "
    "Tugasmu memberikan rekomendasi singkat, konkrit, dan actionable kepada tim sales "
    "berdasarkan data produk pelanggan. "
    "Selalu gunakan bahasa Indonesia. "
    "Jangan menyebut angka margin internal. "
    "Format: 3 aksi konkrit, masing-masing 1-2 kalimat, total maksimal 150 kata."
)

# ── Anthropic Client ──────────────────────────────────────────────────────────
try:
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
except Exception:
    client = None

# ── Supabase Client ───────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
supabase_client = None

if SUPABASE_URL and SUPABASE_KEY:
    initialized = False
    if not initialized:
        try:
            from supabase import create_client
            from supabase.lib.client_options import ClientOptions
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY, options=ClientOptions())
            initialized = True
        except Exception as e:
            print(f"Supabase v2.x init failed: {e}")
    if not initialized:
        try:
            from supabase import create_client
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            initialized = True
        except Exception as e:
            print(f"Supabase v1.x init failed: {e}")
    if not initialized:
        print("WARNING: Supabase initialization failed.")


class SimulateRequest(BaseModel):
    data: List[Any]
    product_mapping: Optional[List[Dict]] = []


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def fmt(v) -> float:
    try: return round(float(v), 2)
    except: return 0.0

def extract_family(spec: str) -> str:
    return spec.split(" ")[0].strip() if spec else "Unknown"

def extract_thickness_mm(spec: str) -> Optional[float]:
    if not spec: return None
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*mm', spec, re.IGNORECASE)
    if m:
        try: return float(m.group(1).replace(',', '.'))
        except: return None
    parts = spec.strip().split()
    if len(parts) >= 2:
        try: return float(parts[1].replace(',', '.'))
        except: return None
    return None

def safe_qty(r: dict) -> float:
    raw = r.get("qty") or r.get("Qty") or r.get("quantity") or r.get("Quantity") or r.get("QTY") or 0
    try: return float(raw)
    except: return 0.0

def calc_gm_pct(sales: float, cogs: float) -> float:
    return (sales - cogs) / sales * 100.0 if sales > 0 else 0.0

def gm_pct_from_ledger(ledger: dict) -> float:
    return calc_gm_pct(
        sum(p["proj_sales"] for p in ledger.values()),
        sum(p["proj_cogs"]  for p in ledger.values()),
    )

def calc_asp(sales: float, qty: float) -> float:
    return round(sales / qty, 2) if qty > 1e-6 else 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# BACKOFF HELPER
# ═══════════════════════════════════════════════════════════════════════════════

async def _backoff_sleep(attempt: int, retry_after: Optional[float] = None):
    if retry_after and retry_after > 0:
        wait = min(retry_after, AI_BACKOFF_MAX_SEC)
        print(f"[Backoff] Retry-after header: {wait:.1f}s")
    else:
        wait = min(AI_BACKOFF_BASE_SEC * (2 ** attempt), AI_BACKOFF_MAX_SEC)
        print(f"[Backoff] Exponential: {wait:.1f}s (attempt {attempt + 1})")
    await asyncio.sleep(wait)


def _parse_retry_after(exc: Exception) -> Optional[float]:
    try:
        headers = getattr(getattr(exc, "response", None), "headers", {}) or {}
        ra = headers.get("retry-after") or headers.get("Retry-After")
        if ra:
            return float(ra)
    except Exception:
        pass
    msg = str(exc)
    m = re.search(r'retry.{1,10}(\d+(?:\.\d+)?)\s*s', msg, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCT CATALOG LOADER
# ═══════════════════════════════════════════════════════════════════════════════

def load_product_catalog() -> Dict[str, Dict]:
    """
    Load cogs_unit & average_selling_price dari product_master di Supabase.
    Return: { product_name: { "unit_price": float, "unit_cogs": float } }
    """
    if not supabase_client:
        return {}
    try:
        result = (
            supabase_client.table("product_master")
            .select("product_name, cogs_unit, average_selling_price")
            .execute()
        )
        catalog = {}
        for row in (result.data or []):
            name = row.get("product_name")
            if not name:
                continue
            cogs_unit = row.get("cogs_unit")
            avg_asp   = row.get("average_selling_price")
            if cogs_unit is not None or avg_asp is not None:
                catalog[name] = {
                    "unit_cogs":  float(cogs_unit) if cogs_unit is not None else None,
                    "unit_price": float(avg_asp)   if avg_asp   is not None else None,
                }
        print(f"[INFO] Product catalog loaded: {len(catalog)} products")
        return catalog
    except Exception as e:
        print(f"[WARN] Gagal load product_catalog: {e}")
        return {}


# ═══════════════════════════════════════════════════════════════════════════════
# PARETO PRODUCTS LOADER
# ═══════════════════════════════════════════════════════════════════════════════

def load_pareto_products() -> Set[str]:
    if not supabase_client: return set()
    try:
        result = (supabase_client.table("product_master")
                  .select("product_name").eq("is_pareto", True).execute())
        specs = {r["product_name"] for r in (result.data or []) if r.get("product_name")}
        print(f"[INFO] Pareto products loaded: {len(specs)}")
        return specs
    except Exception as e:
        print(f"[WARN] Gagal load pareto products: {e}")
        return set()


# ═══════════════════════════════════════════════════════════════════════════════
# LAST MONTH SNAPSHOT
# ═══════════════════════════════════════════════════════════════════════════════

def build_last_month_snapshot(records: List[dict]) -> dict:
    last_key: dict = {}
    for r in records:
        c_id = str(r.get("customer_name", "") or "").strip()
        if not c_id or c_id == "None": continue
        try:
            y, m = int(r.get("sheet_year", 0) or 0), int(r.get("sheet_month", 0) or 0)
        except: continue
        if y and m and (c_id not in last_key or (y, m) > last_key[c_id]):
            last_key[c_id] = (y, m)

    raw: dict = {}
    for r in records:
        c_id = str(r.get("customer_name", "") or "").strip()
        if not c_id or c_id == "None": continue
        try:
            y, m = int(r.get("sheet_year", 0) or 0), int(r.get("sheet_month", 0) or 0)
        except: continue
        if (y, m) != last_key.get(c_id): continue

        spec  = r.get("product_spec")
        sales = float(r.get("net_sales", 0) or 0)
        cogs  = float(r.get("cogs", 0) or 0)
        qty   = safe_qty(r)
        if not spec or qty <= 0: continue

        raw.setdefault(c_id, {}).setdefault(spec, {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
                                                     "family": extract_family(spec)})
        raw[c_id][spec]["net_sales"] += sales
        raw[c_id][spec]["cogs"]      += cogs
        raw[c_id][spec]["qty"]       += qty

    result = {}
    for c_id, prods in raw.items():
        result[c_id] = {"month_key": last_key.get(c_id), "products": {}}
        for spec, d in prods.items():
            gm  = calc_gm_pct(d["net_sales"], d["cogs"])
            asp = d["net_sales"] / d["qty"] if d["qty"] > 0 else 0.0
            result[c_id]["products"][spec] = {
                "spec": spec, "family": d["family"],
                "qty":   fmt(d["qty"]),   "sales": fmt(d["net_sales"]),
                "cogs":  fmt(d["cogs"]),  "gmPct": fmt(gm), "asp": fmt(asp),
            }
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# INDEX & LOOKUP BUILDERS
# ═══════════════════════════════════════════════════════════════════════════════

def build_global_product_index(records: List[dict], catalog: Dict[str, Dict] = None) -> dict:
    if catalog is None:
        catalog = {}

    raw: dict = {}
    for r in records:
        spec  = r.get("product_spec")
        sales = float(r.get("net_sales", 0) or 0)
        cogs  = float(r.get("cogs", 0) or 0)
        qty   = safe_qty(r)
        if not spec or sales <= 0 or qty <= 0: continue
        m_key = (r.get("sheet_year"), r.get("sheet_month"))
        if spec not in raw:
            raw[spec] = {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
                         "family": extract_family(spec),
                         "thickness": extract_thickness_mm(spec), "months_seen": set()}
        raw[spec]["net_sales"] += sales
        raw[spec]["cogs"]      += cogs
        raw[spec]["qty"]       += qty
        if m_key[0] and m_key[1]: raw[spec]["months_seen"].add(m_key)

    index = {}
    for spec, d in raw.items():
        n = max(len(d["months_seen"]), 1)
        as_, ac, aq = d["net_sales"]/n, d["cogs"]/n, d["qty"]/n

        txn_unit_price = as_/aq if aq > 0 else 0.0
        txn_unit_cogs  = ac /aq if aq > 0 else 0.0

        cat = catalog.get(spec, {})
        final_unit_price = cat.get("unit_price") if cat.get("unit_price") is not None else txn_unit_price
        final_unit_cogs  = cat.get("unit_cogs")  if cat.get("unit_cogs")  is not None else txn_unit_cogs

        index[spec] = {
            "family":     d["family"],
            "thickness":  d["thickness"],
            "unit_price": final_unit_price,
            "unit_cogs":  final_unit_cogs,
            "avg_gm_pct": calc_gm_pct(final_unit_price, final_unit_cogs),
        }

    return index


def build_mapping_lookup(product_mapping: List[dict]) -> Dict[str, List[str]]:
    lookup: dict = {}
    for m in sorted(product_mapping, key=lambda x: x.get("mapping_id", 9999)):
        f, t = m.get("product_name", ""), m.get("to_product_name", "")
        if not f or not t or f == t: continue
        lookup.setdefault(f, [])
        if t not in lookup[f]: lookup[f].append(t)
    return lookup


def build_customer_raw(records: List[dict]) -> dict:
    cust: dict = {}
    for r in records:
        c_id  = str(r.get("customer_name", "") or "").strip()
        spec  = r.get("product_spec")
        sales = float(r.get("net_sales", 0) or 0)
        cogs  = float(r.get("cogs", 0) or 0)
        qty   = safe_qty(r)
        if not c_id or c_id == "None" or not spec or sales <= 0: continue

        m_key = (r.get("sheet_year"), r.get("sheet_month"))
        cust.setdefault(c_id, {"months_seen": set(), "products": {}})
        if m_key[0] and m_key[1]: cust[c_id]["months_seen"].add(m_key)

        p = cust[c_id]["products"]
        p.setdefault(spec, {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
                             "family": extract_family(spec)})
        p[spec]["net_sales"] += sales
        p[spec]["cogs"]      += cogs
        p[spec]["qty"]       += qty
    return cust


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 1 CHECKER
# ═══════════════════════════════════════════════════════════════════════════════

def get_customer_product_gm(spec, raw_products, c_months, global_products):
    if spec in raw_products:
        p = raw_products[spec]
        return calc_gm_pct(p["net_sales"]/c_months, p["cogs"]/c_months)
    return None

def is_candidate_acceptable(spec, src_gm, raw_products, c_months, global_products):
    if spec not in global_products: return False
    gm = get_customer_product_gm(spec, raw_products, c_months, global_products)
    eff = gm if gm is not None else global_products[spec]["avg_gm_pct"]
    return eff > src_gm or eff >= TARGET_GM_PCT


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 4 SUBSTITUTION
# ═══════════════════════════════════════════════════════════════════════════════

def find_family_substitution(source_spec, global_products, allowed_specs: Set[str]):
    """
    Cari produk pengganti dalam family yang sama dengan thickness +1mm.
    FIX v8.4.2: hanya cari dalam allowed_specs (produk yang pernah dibeli customer).
    """
    fam, t = extract_family(source_spec), extract_thickness_mm(source_spec)
    if not fam or t is None: return None
    target_t = t + 1.0
    best, best_gm = None, -math.inf
    for spec, info in global_products.items():
        if spec not in allowed_specs: continue          # ← FIX v8.4.2
        if extract_family(spec) != fam: continue
        th = info.get("thickness") or extract_thickness_mm(spec)
        if th is None or abs(th - target_t) >= 0.01: continue
        if info["avg_gm_pct"] > best_gm:
            best_gm, best = info["avg_gm_pct"], spec
    return best


# ═══════════════════════════════════════════════════════════════════════════════
# LEDGER & SWAP
# ═══════════════════════════════════════════════════════════════════════════════

def build_product_ledger(raw_products, c_months):
    """
    Fallback: bangun ledger dari historical average.
    Dipakai jika tidak ada data last month (customer baru).
    """
    ledger = {}
    for spec, d in raw_products.items():
        as_ = d["net_sales"]/c_months
        ac  = d["cogs"]/c_months
        aq  = d["qty"]/c_months
        ledger[spec] = {
            "spec": spec, "family": d["family"],
            "curr_qty": aq, "curr_sales": as_, "curr_cogs": ac,
            "curr_gm_pct": calc_gm_pct(as_, ac),
            "proj_qty": aq, "proj_sales": as_, "proj_cogs": ac, "shifts": [],
        }
    return ledger


def build_ledger_from_snapshot(lm_products: dict, gp: dict) -> dict:
    """
    v8.4.1: Bangun ledger dari last month QTY × harga standar product_master (via gp).

    - qty        : last month actuals — baseline paling relevan untuk bulan depan.
    - unit_price : product_master.average_selling_price (via gp) — harga standar.
    - unit_cogs  : product_master.cogs_unit (via gp) — COGS standar.
    - Fallback ke last month actuals jika produk belum ada di product_master.

    Efek pada retained products (tidak disentuh optimizer):
      proj_qty == curr_qty == last month qty  →  qtyChange == 0  ✓
      proj_sales == curr_sales                →  tidak ada perubahan  ✓
    """
    ledger = {}
    for spec, d in lm_products.items():
        qty = d["qty"]
        if qty <= 0:
            continue

        gp_info = gp.get(spec)
        if gp_info is not None:
            unit_price = gp_info["unit_price"]
            unit_cogs  = gp_info["unit_cogs"]
        else:
            unit_price = d["sales"] / qty if qty > 0 else 0.0
            unit_cogs  = d["cogs"]  / qty if qty > 0 else 0.0
            print(f"[WARN] {spec} tidak ada di product_master, pakai last month actuals.")

        sales = unit_price * qty
        cogs  = unit_cogs  * qty

        ledger[spec] = {
            "spec":        spec,
            "family":      d.get("family", extract_family(spec)),
            "curr_qty":    qty,
            "curr_sales":  sales,
            "curr_cogs":   cogs,
            "curr_gm_pct": calc_gm_pct(sales, cogs),
            "proj_qty":    qty,
            "proj_sales":  sales,
            "proj_cogs":   cogs,
            "shifts":      [],
        }
    return ledger


def _ensure_target(ledger, spec, gp):
    if spec not in ledger:
        info = gp[spec]
        ledger[spec] = {"spec": spec, "family": info["family"],
                        "curr_qty": 0.0, "curr_sales": 0.0, "curr_cogs": 0.0,
                        "curr_gm_pct": info["avg_gm_pct"],
                        "proj_qty": 0.0, "proj_sales": 0.0, "proj_cogs": 0.0, "shifts": []}


def apply_full_swap(ledger, src_spec, tgt_spec, gp):
    src = ledger.get(src_spec)
    if src is None or src["proj_qty"] < 1e-6: return None

    qty       = src["proj_qty"]
    src_price = src["proj_sales"] / qty if qty > 0 else 0.0

    src["proj_qty"] = src["proj_sales"] = src["proj_cogs"] = 0.0
    _ensure_target(ledger, tgt_spec, gp)

    tgt  = ledger[tgt_spec]
    info = gp[tgt_spec]
    tgt["proj_qty"]   += qty
    tgt["proj_sales"] += info["unit_price"] * qty
    tgt["proj_cogs"]  += info["unit_cogs"]  * qty

    move = {
        "family":           src["family"],
        "from":             src_spec,
        "to":               tgt_spec,
        "shifted_qty":      fmt(qty),
        "src_unit_price":   fmt(src_price),
        "sales_from_shift": fmt(info["unit_price"] * qty),
        "sales_uplift":     fmt((info["unit_price"] - src_price) * qty),
        "is_partial":       False,
        "pareto":           False,
        "retained_qty":     0.0,
    }
    src["shifts"].append(move)
    return move


def apply_pareto_partial_swap(ledger, src_spec, tgt_spec, gp):
    src = ledger.get(src_spec)
    if src is None or src["proj_qty"] < 1e-6: return None

    total_qty  = src["proj_qty"]
    keep_qty   = total_qty * PARETO_MIN_QTY_RATIO
    shift_qty  = total_qty - keep_qty
    if shift_qty < 1e-6: return None

    src_price  = src["proj_sales"] / total_qty if total_qty > 0 else 0.0
    src_cogs_u = src["proj_cogs"]  / total_qty if total_qty > 0 else 0.0

    src["proj_qty"]   = keep_qty
    src["proj_sales"] = src_price  * keep_qty
    src["proj_cogs"]  = src_cogs_u * keep_qty

    _ensure_target(ledger, tgt_spec, gp)
    tgt  = ledger[tgt_spec]
    info = gp[tgt_spec]
    tgt["proj_qty"]   += shift_qty
    tgt["proj_sales"] += info["unit_price"] * shift_qty
    tgt["proj_cogs"]  += info["unit_cogs"]  * shift_qty

    move = {
        "family":           src["family"],
        "from":             src_spec,
        "to":               tgt_spec,
        "shifted_qty":      fmt(shift_qty),
        "src_unit_price":   fmt(src_price),
        "sales_from_shift": fmt(info["unit_price"] * shift_qty),
        "sales_uplift":     fmt((info["unit_price"] - src_price) * shift_qty),
        "is_partial":       True,
        "pareto":           True,
        "retained_qty":     fmt(keep_qty),
    }
    src["shifts"].append(move)
    return move


# ═══════════════════════════════════════════════════════════════════════════════
# OPTIMIZATION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

def run_optimization_engine(ledger, mapping_lookup, gp, raw_products, c_months, pareto_specs):
    """
    FIX v8.4.2: kandidat swap difilter ke ever_bought (produk yang pernah dibeli
    customer kapanpun). Berlaku untuk mapping_lookup DAN family substitution.

    ever_bought = set(raw_products.keys()) = semua produk di histori customer
                  (seluruh periode, bukan hanya last month).
    """
    all_moves, exhausted = [], set()
    visited_pairs: Set[tuple] = set()

    # Whitelist: semua produk yang pernah dibeli customer kapanpun  ← v8.4.2
    ever_bought: Set[str] = set(raw_products.keys())

    for _ in range(len(ledger) * 20):
        if gm_pct_from_ledger(ledger) >= TARGET_GM_PCT: break

        worst_spec, worst_gm = None, math.inf
        for spec, p in ledger.items():
            if p["proj_qty"] < 1e-6 or spec in exhausted: continue
            if spec in pareto_specs:
                if p["proj_qty"] <= p["curr_qty"] * PARETO_MIN_QTY_RATIO + 1e-6: continue
            pgm = calc_gm_pct(p["proj_sales"], p["proj_cogs"])
            if pgm < worst_gm: worst_gm, worst_spec = pgm, spec
        if worst_spec is None: break

        # FIX v8.4.2: hanya kandidat yang pernah dibeli customer
        candidates = [
            c for c in mapping_lookup.get(worst_spec, [])
            if (c, worst_spec) not in visited_pairs
            and c in ever_bought                                        # ← v8.4.2
        ]

        chosen = _pick_best_candidate(worst_spec, worst_gm, candidates, raw_products, c_months, gp)

        # FIX v8.4.2: family substitution juga dibatasi ke ever_bought
        if chosen is None:
            fb = find_family_substitution(worst_spec, gp, ever_bought)  # ← v8.4.2
            if (fb and fb != worst_spec
                    and (fb, worst_spec) not in visited_pairs
                    and is_candidate_acceptable(fb, worst_gm, raw_products, c_months, gp)):
                chosen = fb

        if chosen is None:
            exhausted.add(worst_spec)
            continue

        pair = (worst_spec, chosen)
        if pair in visited_pairs:
            exhausted.add(worst_spec)
            continue
        visited_pairs.add(pair)

        fn   = apply_pareto_partial_swap if worst_spec in pareto_specs else apply_full_swap
        move = fn(ledger, worst_spec, chosen, gp)
        if move:
            all_moves.append(move)
        else:
            exhausted.add(worst_spec)

    return all_moves


def _pick_best_candidate(src_spec, src_gm, candidates, raw_products, c_months, gp):
    t1, t2, t3, t4 = [], [], [], []
    for cand in candidates:
        if cand == src_spec or cand not in gp: continue
        cgm = get_customer_product_gm(cand, raw_products, c_months, gp)
        ggm = gp[cand]["avg_gm_pct"]
        if cgm is not None:
            (t1 if cgm >= TARGET_GM_PCT else t2).append((cand, cgm))
        else:
            (t3 if ggm >= TARGET_GM_PCT else t4).append((cand, ggm))
    for tier in [t1, t2, t3, t4]:
        if tier: return sorted(tier, key=lambda x: x[1], reverse=True)[0][0]
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# SHIFT CARDS & NEXT MONTH PLAN
# ═══════════════════════════════════════════════════════════════════════════════

def aggregate_moves(moves):
    agg = {}
    for mv in moves:
        key = (mv["from"], mv["to"])
        if key not in agg:
            agg[key] = mv.copy()
        else:
            e = agg[key]
            e["shifted_qty"]      = fmt(e["shifted_qty"]      + mv["shifted_qty"])
            e["sales_from_shift"] = fmt(e["sales_from_shift"] + mv["sales_from_shift"])
            e["sales_uplift"]     = fmt(e["sales_uplift"]     + mv["sales_uplift"])
            e["is_partial"] = e["is_partial"] or mv["is_partial"]
            e["pareto"]     = e.get("pareto", False) or mv.get("pareto", False)
    return list(agg.values())


def _snap(spec, ledger, gp, projected=False):
    p = ledger.get(spec)
    g = gp.get(spec, {})
    if p is None:
        return {"qty": 0.0, "sales": 0.0, "cogs": fmt(g.get("unit_cogs", 0)),
                "asp": fmt(g.get("unit_price", 0)), "gmPct": fmt(g.get("avg_gm_pct", 0))}
    qty   = p["proj_qty"]   if projected else p["curr_qty"]
    sales = p["proj_sales"] if projected else p["curr_sales"]
    cogs  = p["proj_cogs"]  if projected else p["curr_cogs"]
    asp   = calc_asp(sales, qty) or fmt(g.get("unit_price", 0))
    return {"qty": fmt(qty), "sales": fmt(sales), "cogs": fmt(cogs),
            "asp": fmt(asp), "gmPct": fmt(calc_gm_pct(sales, cogs))}


def format_shift_cards(agg_moves, ledger, gp):
    cards = []
    for mv in agg_moves:
        fs, ts = mv["from"], mv["to"]
        fc = _snap(fs, ledger, gp, False)
        fp = _snap(fs, ledger, gp, True)
        tc = _snap(ts, ledger, gp, False)
        tp = _snap(ts, ledger, gp, True)

        src_asp = mv.get("src_unit_price") or (
            fc["asp"] if fc["qty"] > 1e-6 else gp.get(fs, {}).get("unit_price", 0)
        )
        tgt_asp = gp.get(ts, {}).get("unit_price", tp["asp"])
        fcu     = gp.get(fs, {}).get("unit_cogs", 0)
        tpu     = gp.get(ts, {}).get("unit_cogs", 0)

        cards.append({
            "shiftId":     f"{fs}__to__{ts}",
            "family":      mv.get("family", extract_family(fs)),
            "isPartial":   mv["is_partial"],
            "isPareto":    mv.get("pareto", False),
            "swapType":    "pareto_partial" if mv.get("pareto") else "full",
            "retainedQty": mv.get("retained_qty", 0.0),
            "fromProduct": {
                "spec":      fs,
                "family":    ledger.get(fs, {}).get("family", extract_family(fs)),
                "current":   fc,
                "projected": fp,
            },
            "toProduct": {
                "spec":      ts,
                "family":    ledger.get(ts, {}).get("family", extract_family(ts)),
                "current":   tc,
                "projected": tp,
            },
            "shift": {
                "shiftedQty":     mv["shifted_qty"],
                "salesFromShift": mv["sales_from_shift"],
                "salesUplift":    mv["sales_uplift"],
            },
            "delta": {
                "asp":         fmt(tgt_asp - src_asp),
                "cogsPerUnit": fmt(tpu - fcu),
                "gmPct":       fmt(tp["gmPct"] - fc["gmPct"]),
            },
        })

    cards.sort(key=lambda c: c["shift"]["salesUplift"], reverse=True)
    return cards


def build_next_month_plan(ledger, gp, pareto_specs, last_mo_prods, shift_cards):
    shifted_from = {c["fromProduct"]["spec"] for c in shift_cards}
    shifted_to   = {c["toProduct"]["spec"]   for c in shift_cards}
    retained, shifted_in, removed = [], [], []

    for spec, p in ledger.items():
        ent = {
            "spec": spec,
            "family": p.get("family", extract_family(spec)),
            "isPareto": spec in pareto_specs,

            # -- FIX APEL VS JERUK: Data Current murni dari Ledger --
            "lastMonthQty": fmt(p["curr_qty"]),
            "lastMonthSales": fmt(p["curr_sales"]),
            "lastMonthGmPct": fmt(p["curr_gm_pct"]),
            "lastMonthAsp": fmt(calc_asp(p["curr_sales"], p["curr_qty"])),
            # -------------------------------------------------------

            "projQty": fmt(p["proj_qty"]),
            "projSales": fmt(p["proj_sales"]),
            "projCogs": fmt(p["proj_cogs"]),
            "projGmPct": fmt(calc_gm_pct(p["proj_sales"], p["proj_cogs"])),
            "projAsp": fmt(calc_asp(p["proj_sales"], p["proj_qty"])),
        }

        # -- FIX BLANK CARDS: Logika append yang kemarin ga sengaja kehapus --
        if p["proj_qty"] < 1e-6:
            if spec not in shifted_from:
                removed.append(ent)
        elif spec in shifted_to and spec not in last_mo_prods:
            shifted_in.append(ent)
        else:
            # Produk "No Change" atau yang Qty-nya diturunin masuk ke sini
            retained.append({**ent, "qtyChange": fmt(p["proj_qty"] - p["curr_qty"])})

    retained.sort(key=lambda x: x["projSales"], reverse=True)
    shifted_in.sort(key=lambda x: x["projSales"], reverse=True)
    removed.sort(key=lambda x: x["lastMonthSales"], reverse=True)

    return {
        "retainedProducts": retained,
        "shiftedInProducts": shifted_in,
        "removedProducts": removed,
        "summary": {
            "retainedCount": len(retained),
            "shiftedInCount": len(shifted_in),
            "removedCount": len(removed),
        },
    }

# ═══════════════════════════════════════════════════════════════════════════════
# AI — ANTHROPIC BATCHES API
# ═══════════════════════════════════════════════════════════════════════════════

def _build_batch_request(i: int, cr: dict) -> dict:
    moves_parts = []
    for card in cr["shift_cards"][:3]:
        label = "[PARETO-partial]" if card.get("isPareto") else "[full-swap]"
        moves_parts.append(
            f"{card['fromProduct']['spec']}→{card['toProduct']['spec']} "
            f"{label} qty:{card['shift']['shiftedQty']}, uplift:{card['shift']['salesUplift']:,.0f}"
        )

    dynamic_text = (
        f"Customer: {cr['c_id']}\n"
        f"GM saat ini: {cr['current_gm_pct']:.1f}% → proyeksi: {cr['projected_gm_pct']:.1f}% "
        f"(target {TARGET_GM_PCT}%)\n"
        f"Shift produk: {'; '.join(moves_parts) or 'tidak ada'}\n"
        f"Produk pareto (wajib jual): {', '.join(cr.get('pareto_in_mix', [])[:3]) or 'tidak ada'}\n"
        f"Produk upsell potensial: {', '.join(cr.get('upsell_existing', [])[:3]) or 'tidak ada'}"
    )

    safe_id   = re.sub(r"[^a-zA-Z0-9]", "-", cr["c_id"])[:48]
    custom_id = f"cr{i}-{safe_id}"

    return {
        "custom_id": custom_id,
        "params": {
            "model":       AI_MODEL,
            "max_tokens":  AI_MAX_TOKENS,
            "temperature": AI_TEMPERATURE,
            "system": [
                {
                    "type": "text",
                    "text": AI_SYSTEM_CONTEXT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": dynamic_text}],
        },
    }


async def _create_batch_with_backoff(loop, batch_requests: list, chunk_num: int) -> Optional[Any]:
    for attempt in range(AI_MAX_RETRIES):
        try:
            batch = await loop.run_in_executor(
                None,
                lambda reqs=batch_requests: client.messages.batches.create(requests=reqs),
            )
            print(f"[AI Batch] Chunk {chunk_num}: batch created → id={batch.id}")
            return batch
        except Exception as e:
            err_str = str(e)
            is_rate_limit = ("429" in err_str
                             or "rate_limit" in err_str.lower()
                             or "acceleration" in err_str.lower())
            print(f"[AI Batch] Chunk {chunk_num} create error "
                  f"(attempt {attempt+1}/{AI_MAX_RETRIES}): {e}")
            if attempt + 1 >= AI_MAX_RETRIES:
                print(f"[AI Batch] Chunk {chunk_num}: semua retry habis, skip.")
                return None
            ra = _parse_retry_after(e) if is_rate_limit else None
            await _backoff_sleep(attempt, ra)
    return None


async def _retrieve_results(loop, batch_id: str, chunk_num: int) -> Dict[str, str]:
    try:
        items = await loop.run_in_executor(
            None, lambda bid=batch_id: list(client.messages.batches.results(bid))
        )
        results: Dict[str, str] = {}
        for item in items:
            if item.result.type == "succeeded":
                results[item.custom_id] = item.result.message.content[0].text
            else:
                err_type = getattr(getattr(item.result, "error", None), "type", "unknown")
                results[item.custom_id] = f"AI batch error: {err_type}"
        print(f"[AI Batch] Chunk {chunk_num}: {len(results)} results retrieved.")
        return results
    except Exception as e:
        print(f"[AI Batch] Chunk {chunk_num} retrieve error: {e}")
        return {}


async def generate_ai_reasoning_batch(customer_results: list) -> List[str]:
    # 1. Default message dibedain per status
    final = [
        "GM sudah optimal. Pertahankan mix produk saat ini."
        if cr["status"] == "On Target"
        else "Tidak ditemukan kandidat produk pengganti dari histori pembelian customer ini. "
            "Pertimbangkan negosiasi ulang harga atau penambahan produk baru ke portofolio customer."
        for cr in customer_results
    ]

    # 2. Kirim ke AI meski shift_cards kosong, selama Needs Optimization
    if cr["status"] == "Needs Optimization":   # ← hapus "and cr['shift_cards']"

    all_requests: List[dict] = []
    needs_ai: List[tuple]    = []
    for i, cr in enumerate(customer_results):
        if cr["status"] == "Needs Optimization" and cr["shift_cards"]:
            req = _build_batch_request(i, cr)
            all_requests.append({
                "index":     i,
                "custom_id": req["custom_id"],
                "params":    req["params"],
            })
            needs_ai.append((i, req["custom_id"]))

    if not all_requests:
        print("[AI Batch] Tidak ada customer yang butuh AI reasoning.")
        return final

    chunks = [
        all_requests[s:s + AI_BATCH_CHUNK_SIZE]
        for s in range(0, len(all_requests), AI_BATCH_CHUNK_SIZE)
    ]
    total_chunks = len(chunks)
    print(f"[AI Batch] {len(all_requests)} requests → {total_chunks} chunk(s) "
          f"(chunk_size={AI_BATCH_CHUNK_SIZE})")

    loop = asyncio.get_running_loop()

    # ── PHASE 1: Submit semua chunks ─────────────────────────────────────────
    submitted: List[Optional[Any]]    = []
    chunk_custom_ids: List[List[str]] = []

    for chunk_idx, chunk in enumerate(chunks):
        chunk_num = chunk_idx + 1
        batch_requests = [{"custom_id": r["custom_id"], "params": r["params"]} for r in chunk]
        chunk_custom_ids.append([r["custom_id"] for r in chunk])

        batch = await _create_batch_with_backoff(loop, batch_requests, chunk_num)
        submitted.append(batch)

        if batch is None:
            print(f"[AI Batch] Chunk {chunk_num}: gagal submit, akan di-skip.")
        else:
            print(f"[AI Batch] Chunk {chunk_num}/{total_chunks} submitted → {batch.id}")

        if chunk_idx < total_chunks - 1 and AI_BATCH_SUBMIT_DELAY_SEC > 0:
            print(f"[AI Batch] Submit delay {AI_BATCH_SUBMIT_DELAY_SEC}s ...")
            await asyncio.sleep(AI_BATCH_SUBMIT_DELAY_SEC)

    # ── PHASE 2: Poll SEMUA batch secara paralel ──────────────────────────────
    async def poll_and_retrieve(batch_obj, chunk_idx: int) -> Dict[str, str]:
        if batch_obj is None:
            return {cid: "AI batch chunk gagal dibuat." for cid in chunk_custom_ids[chunk_idx]}

        chunk_num = chunk_idx + 1
        await asyncio.sleep(chunk_idx * AI_BATCH_POLL_JITTER_SEC)

        elapsed = 0
        while elapsed < AI_BATCH_MAX_WAIT:
            await asyncio.sleep(AI_BATCH_POLL_SEC)
            elapsed += AI_BATCH_POLL_SEC
            try:
                status_obj = await loop.run_in_executor(
                    None, lambda bid=batch_obj.id: client.messages.batches.retrieve(bid)
                )
                c = status_obj.request_counts
                print(f"[AI Batch] Chunk {chunk_num} | {elapsed}s | "
                      f"{status_obj.processing_status} | "
                      f"ok={c.succeeded} err={c.errored} proc={c.processing}")
                if status_obj.processing_status == "ended":
                    return await _retrieve_results(loop, batch_obj.id, chunk_num)
            except Exception as e:
                print(f"[AI Batch] Chunk {chunk_num} poll error: {e}")

        print(f"[AI Batch] Chunk {chunk_num}: timeout {AI_BATCH_MAX_WAIT}s.")
        return {
            cid: f"AI reasoning timeout (>{AI_BATCH_MAX_WAIT}s)."
            for cid in chunk_custom_ids[chunk_idx]
        }

    poll_results_list = await asyncio.gather(
        *[poll_and_retrieve(batch_obj, idx) for idx, batch_obj in enumerate(submitted)]
    )

    results_map: Dict[str, str] = {}
    for chunk_results in poll_results_list:
        results_map.update(chunk_results)

    for i, custom_id in needs_ai:
        final[i] = results_map.get(custom_id, f"Hasil AI tidak ditemukan (idx={i}).")

    ok = sum(1 for _, cid in needs_ai
             if cid in results_map and not results_map[cid].startswith("AI"))
    print(f"[AI Batch] Selesai: {ok}/{len(needs_ai)} sukses.")
    return final


# ═══════════════════════════════════════════════════════════════════════════════
# SUPABASE CHUNKED UPSERT
# ═══════════════════════════════════════════════════════════════════════════════

def supabase_upsert_chunked(table, payload, chunk_size=SUPABASE_CHUNK):
    if not supabase_client or not payload: return
    for i in range(0, len(payload), chunk_size):
        try: supabase_client.table(table).upsert(payload[i:i+chunk_size]).execute()
        except Exception as e: print(f"Error upsert chunk {i}: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/simulate")
async def simulate_product_mix(payload: SimulateRequest):
    t0 = time.time()
    records, product_mapping = payload.data, payload.product_mapping or []

    if not records:
        raise HTTPException(status_code=400, detail="No valid data array found in payload")

    if not product_mapping and supabase_client:
        try:
            res = supabase_client.table("view_product_related").select("*").order("priority").execute()
            product_mapping = res.data or []
        except Exception as e:
            print(f"Gagal load product_mapping: {e}")

    product_catalog = load_product_catalog()
    pareto_specs    = load_pareto_products()
    gp              = build_global_product_index(records, catalog=product_catalog)
    base_mapping    = build_mapping_lookup(product_mapping)
    customer_raw    = build_customer_raw(records)
    last_month_all  = build_last_month_snapshot(records)

    print(f"[INFO] records={len(records)} | customers={len(customer_raw)} | "
          f"global_products={len(gp)} | pareto_specs={len(pareto_specs)} | "
          f"catalog_products={len(product_catalog)}")

    # ── Kalkulasi (sync) ──────────────────────────────────────────────────────
    customer_results = []
    for c_id, raw in customer_raw.items():
        c_months = max(len(raw["months_seen"]), 1)

        # Ambil last month snapshot untuk customer ini
        c_lm          = last_month_all.get(c_id, {})
        c_lm_products = c_lm.get("products", {})
        c_lm_key      = c_lm.get("month_key")

        # Baseline ledger: last month qty × harga product_master  (v8.4.1)
        # Fallback ke historical avg jika tidak ada data last month (customer baru)
        if c_lm_products:
            ledger = build_ledger_from_snapshot(c_lm_products, gp)
        else:
            print(f"[WARN] {c_id}: tidak ada data last month, fallback ke historical average.")
            ledger = build_product_ledger(raw["products"], c_months)

        tcs = sum(p["curr_sales"] for p in ledger.values())
        tcc = sum(p["curr_cogs"]  for p in ledger.values())
        tcq = sum(p["curr_qty"]   for p in ledger.values())
        cgm = calc_gm_pct(tcs, tcc)

        local_map = {k: list(v) for k, v in base_mapping.items()}

        # Optimizer: raw["products"] sebagai whitelist ever_bought  (v8.4.2)
        raw_moves = (
            run_optimization_engine(ledger, local_map, gp, raw["products"], c_months, pareto_specs)
            if cgm < TARGET_GM_PCT else []
        )

        agg_moves   = aggregate_moves(raw_moves)
        shift_cards = format_shift_cards(agg_moves, ledger, gp)

        tps = sum(p["proj_sales"] for p in ledger.values())
        tpc = sum(p["proj_cogs"]  for p in ledger.values())
        tpq = sum(p["proj_qty"]   for p in ledger.values())
        pgm = calc_gm_pct(tps, tpc)

        nmp = build_next_month_plan(ledger, gp, pareto_specs, c_lm_products, shift_cards)

        customer_results.append({
            "c_id":             c_id,
            "c_months":         c_months,
            "c_last_month_key": c_lm_key,
            "shift_cards":      shift_cards,
            "next_month_plan":  nmp,
            "upsell_existing": [
                s for s, p in ledger.items()
                if p["curr_gm_pct"] >= TARGET_GM_PCT and p["curr_qty"] > 0
            ],
            "reduce_or_renegotiate": [
                s for s, p in ledger.items()
                if p["curr_gm_pct"] < TARGET_GM_PCT
                and p["proj_qty"] >= p["curr_qty"] - 1e-6
                and p["curr_qty"] > 0
            ],
            "pareto_in_mix": [
                s for s in ledger if s in pareto_specs and ledger[s]["curr_qty"] > 0
            ],
            "current_gm_pct":   cgm,
            "projected_gm_pct": pgm,
            "total_curr_sales": tcs,
            "total_curr_cogs":  tcc,
            "total_curr_qty":   tcq,
            "total_proj_sales": tps,
            "total_proj_cogs":  tpc,
            "total_proj_qty":   tpq,
            "status": "On Target" if cgm >= TARGET_GM_PCT else "Needs Optimization",
        })

    t1 = time.time()
    print(f"[PERF] Kalkulasi selesai: {t1-t0:.2f}s")

    # ── AI via Batches API ────────────────────────────────────────────────────
    ai_reasonings = await generate_ai_reasoning_batch(customer_results)
    t2 = time.time()
    print(f"[PERF] AI Batch selesai: {t2-t1:.2f}s | Total: {t2-t0:.2f}s")

    # ── Assemble response ─────────────────────────────────────────────────────
    recommendations, db_payload = [], []
    for cr, ai_r in zip(customer_results, ai_reasonings):
        lmk = cr["c_last_month_key"]
        lml = f"{lmk[0]}-{str(lmk[1]).zfill(2)}" if lmk else "unknown"

        rec = {
            "customerId":       cr["c_id"],
            "historicalMonths": cr["c_months"],
            "lastMonthRef":     lml,
            "currentPerformance": {
                "nettSales":    fmt(cr["total_curr_sales"]),
                "currentQty":   fmt(cr["total_curr_qty"]),
                "currentGmPct": fmt(cr["current_gm_pct"]),
                "status":       cr["status"],
            },
            "projectedPerformance": {
                "projectedSales": fmt(cr["total_proj_sales"]),
                "projectedQty":   fmt(cr["total_proj_qty"]),
                "projectedGmPct": fmt(cr["projected_gm_pct"]),
                "targetGmPct":    TARGET_GM_PCT,
                "improvement":    fmt(cr["projected_gm_pct"] - cr["current_gm_pct"]),
            },
            "nextMonthPlan": cr["next_month_plan"],
            "productMixStrategy": {
                "paretoInMix":         cr["pareto_in_mix"],
                "reduceOrRenegotiate": cr["reduce_or_renegotiate"],
                "upsellExisting":      cr["upsell_existing"],
                "shiftCards":          cr["shift_cards"],
                "aiReasoning":         ai_r,
            },
        }
        recommendations.append(rec)
        db_payload.append({
            "customer_id":           cr["c_id"],
            "historical_months":     cr["c_months"],
            "last_month_ref":        lml,
            "current_performance":   rec["currentPerformance"],
            "projected_performance": rec["projectedPerformance"],
            "next_month_plan":       cr["next_month_plan"],
            "pareto_in_mix":         cr["pareto_in_mix"],
            "shift_cards":           cr["shift_cards"],
            "ai_reasoning":          ai_r,
        })

    recommendations.sort(key=lambda x: x["currentPerformance"]["currentGmPct"])
    # supabase_upsert_chunked("customer_strategies", db_payload)

    total_chunks_used = math.ceil(
        sum(1 for cr in customer_results
            if cr["status"] == "Needs Optimization" and cr["shift_cards"])
        / AI_BATCH_CHUNK_SIZE
    ) if any(cr["status"] == "Needs Optimization" for cr in customer_results) else 0

    return {
        "metadata": {
            "version":               "8.4.2",
            "totalCustomers":        len(recommendations),
            "paretoProducts":        len(pareto_specs),
            "catalogProducts":       len(product_catalog),
            "aiMode":                "batches_api_submit_all_poll_parallel",
            "aiModel":               AI_MODEL,
            "aiBatchChunkSize":      AI_BATCH_CHUNK_SIZE,
            "aiBatchChunksUsed":     total_chunks_used,
            "aiBatchSubmitDelaySec": AI_BATCH_SUBMIT_DELAY_SEC,
            "calcTimeSec":           round(t1-t0, 2),
            "aiTimeSec":             round(t2-t1, 2),
            "totalTimeSec":          round(t2-t0, 2),
        },
        "recommendations": recommendations,
    }


@app.get("/health")
def health():
    return {
        "status":                "ok",
        "version":               "8.4.2",
        "ai_mode":               "Anthropic Batches API — submit-all, poll-parallel, backoff-protected",
        "ai_model":              AI_MODEL,
        "ai_batch_chunk_size":   AI_BATCH_CHUNK_SIZE,
        "ai_batch_submit_delay": f"{AI_BATCH_SUBMIT_DELAY_SEC}s",
        "ai_batch_poll_sec":     AI_BATCH_POLL_SEC,
        "ai_batch_max_wait":     f"{AI_BATCH_MAX_WAIT}s",
        "ai_max_retries":        AI_MAX_RETRIES,
        "ai_backoff_max_sec":    AI_BACKOFF_MAX_SEC,
        "pareto_min_qty_ratio":  PARETO_MIN_QTY_RATIO,
        "supabase_connected":    supabase_client is not None,
    }


# """
# OptiGain AI Product Mix Simulator — v8.4.2
# Revamp dari v8.4.1

# Perubahan utama:
#   - FIX: run_optimization_engine() — kandidat swap (dari mapping_lookup maupun
#          family substitution fallback) sekarang difilter hanya ke produk yang
#          PERNAH dibeli customer kapanpun (ada di raw_products / histori customer).
#          Produk yang belum pernah dibeli tidak akan muncul di projected.
#   - RETAINED: Semua fitur v8.4.1:
#       · build_ledger_from_snapshot() — baseline ledger dari last month qty
#         × harga standar product_master (via gp).
#       · Fallback ke build_product_ledger() (historical avg) untuk customer baru
#         tanpa data last month.
#       · Semua fix v8.4.0 (visited_pairs, src_unit_price, submit-all-poll-parallel).
#   - GUARANTEED: Output field names tidak berubah sama sekali.

# Business logic yang disepakati:
#   current   = last month actuals (qty × harga product_master)
#   projected = rekomendasi bulan depan
#   target swap: HANYA produk yang pernah dibeli customer kapanpun (raw_products),
#                BUKAN produk baru yang belum pernah dibeli sama sekali.
# """

# import os
# import asyncio
# import math
# import time
# import re
# from fastapi import FastAPI, HTTPException
# from pydantic import BaseModel
# from typing import Any, List, Dict, Optional, Set
# import anthropic

# app = FastAPI(title="OptiGain AI Product Mix Simulator", version="8.4.2")

# TARGET_GM_PCT        = 9.0
# SUPABASE_CHUNK       = 50
# PARETO_MIN_QTY_RATIO = 0.5

# # ── AI Config ─────────────────────────────────────────────────────────────────
# AI_MODEL                  = "claude-sonnet-4-6"
# AI_MAX_TOKENS             = 300
# AI_TEMPERATURE            = 0.3
# AI_BATCH_CHUNK_SIZE       = 50
# AI_BATCH_SUBMIT_DELAY_SEC = 0
# AI_BATCH_POLL_SEC         = 5
# AI_BATCH_POLL_JITTER_SEC  = 2
# AI_BATCH_MAX_WAIT         = 300
# AI_BACKOFF_BASE_SEC       = 5.0
# AI_BACKOFF_MAX_SEC        = 60.0
# AI_MAX_RETRIES            = 5

# # ── System Prompt ─────────────────────────────────────────────────────────────
# AI_SYSTEM_CONTEXT = (
#     "Kamu adalah sales advisor spesialis kaca. "
#     "Tugasmu memberikan rekomendasi singkat, konkrit, dan actionable kepada tim sales "
#     "berdasarkan data produk pelanggan. "
#     "Selalu gunakan bahasa Indonesia. "
#     "Jangan menyebut angka margin internal. "
#     "Format: 3 aksi konkrit, masing-masing 1-2 kalimat, total maksimal 150 kata."
# )

# # ── Anthropic Client ──────────────────────────────────────────────────────────
# try:
#     client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
# except Exception:
#     client = None

# # ── Supabase Client ───────────────────────────────────────────────────────────
# SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
# SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
# supabase_client = None

# if SUPABASE_URL and SUPABASE_KEY:
#     initialized = False
#     if not initialized:
#         try:
#             from supabase import create_client
#             from supabase.lib.client_options import ClientOptions
#             supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY, options=ClientOptions())
#             initialized = True
#         except Exception as e:
#             print(f"Supabase v2.x init failed: {e}")
#     if not initialized:
#         try:
#             from supabase import create_client
#             supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
#             initialized = True
#         except Exception as e:
#             print(f"Supabase v1.x init failed: {e}")
#     if not initialized:
#         print("WARNING: Supabase initialization failed.")


# class SimulateRequest(BaseModel):
#     data: List[Any]
#     product_mapping: Optional[List[Dict]] = []


# # ═══════════════════════════════════════════════════════════════════════════════
# # HELPERS
# # ═══════════════════════════════════════════════════════════════════════════════

# def fmt(v) -> float:
#     try: return round(float(v), 2)
#     except: return 0.0

# def extract_family(spec: str) -> str:
#     return spec.split(" ")[0].strip() if spec else "Unknown"

# def extract_thickness_mm(spec: str) -> Optional[float]:
#     if not spec: return None
#     m = re.search(r'(\d+(?:[.,]\d+)?)\s*mm', spec, re.IGNORECASE)
#     if m:
#         try: return float(m.group(1).replace(',', '.'))
#         except: return None
#     parts = spec.strip().split()
#     if len(parts) >= 2:
#         try: return float(parts[1].replace(',', '.'))
#         except: return None
#     return None

# def safe_qty(r: dict) -> float:
#     raw = r.get("qty") or r.get("Qty") or r.get("quantity") or r.get("Quantity") or r.get("QTY") or 0
#     try: return float(raw)
#     except: return 0.0

# def calc_gm_pct(sales: float, cogs: float) -> float:
#     return (sales - cogs) / sales * 100.0 if sales > 0 else 0.0

# def gm_pct_from_ledger(ledger: dict) -> float:
#     return calc_gm_pct(
#         sum(p["proj_sales"] for p in ledger.values()),
#         sum(p["proj_cogs"]  for p in ledger.values()),
#     )

# def calc_asp(sales: float, qty: float) -> float:
#     return round(sales / qty, 2) if qty > 1e-6 else 0.0


# # ═══════════════════════════════════════════════════════════════════════════════
# # BACKOFF HELPER
# # ═══════════════════════════════════════════════════════════════════════════════

# async def _backoff_sleep(attempt: int, retry_after: Optional[float] = None):
#     if retry_after and retry_after > 0:
#         wait = min(retry_after, AI_BACKOFF_MAX_SEC)
#         print(f"[Backoff] Retry-after header: {wait:.1f}s")
#     else:
#         wait = min(AI_BACKOFF_BASE_SEC * (2 ** attempt), AI_BACKOFF_MAX_SEC)
#         print(f"[Backoff] Exponential: {wait:.1f}s (attempt {attempt + 1})")
#     await asyncio.sleep(wait)


# def _parse_retry_after(exc: Exception) -> Optional[float]:
#     try:
#         headers = getattr(getattr(exc, "response", None), "headers", {}) or {}
#         ra = headers.get("retry-after") or headers.get("Retry-After")
#         if ra:
#             return float(ra)
#     except Exception:
#         pass
#     msg = str(exc)
#     m = re.search(r'retry.{1,10}(\d+(?:\.\d+)?)\s*s', msg, re.IGNORECASE)
#     if m:
#         return float(m.group(1))
#     return None


# # ═══════════════════════════════════════════════════════════════════════════════
# # PRODUCT CATALOG LOADER
# # ═══════════════════════════════════════════════════════════════════════════════

# def load_product_catalog() -> Dict[str, Dict]:
#     """
#     Load cogs_unit & average_selling_price dari product_master di Supabase.
#     Return: { product_name: { "unit_price": float, "unit_cogs": float } }
#     """
#     if not supabase_client:
#         return {}
#     try:
#         result = (
#             supabase_client.table("product_master")
#             .select("product_name, cogs_unit, average_selling_price")
#             .execute()
#         )
#         catalog = {}
#         for row in (result.data or []):
#             name = row.get("product_name")
#             if not name:
#                 continue
#             cogs_unit = row.get("cogs_unit")
#             avg_asp   = row.get("average_selling_price")
#             if cogs_unit is not None or avg_asp is not None:
#                 catalog[name] = {
#                     "unit_cogs":  float(cogs_unit) if cogs_unit is not None else None,
#                     "unit_price": float(avg_asp)   if avg_asp   is not None else None,
#                 }
#         print(f"[INFO] Product catalog loaded: {len(catalog)} products")
#         return catalog
#     except Exception as e:
#         print(f"[WARN] Gagal load product_catalog: {e}")
#         return {}


# # ═══════════════════════════════════════════════════════════════════════════════
# # PARETO PRODUCTS LOADER
# # ═══════════════════════════════════════════════════════════════════════════════

# def load_pareto_products() -> Set[str]:
#     if not supabase_client: return set()
#     try:
#         result = (supabase_client.table("product_master")
#                   .select("product_name").eq("is_pareto", True).execute())
#         specs = {r["product_name"] for r in (result.data or []) if r.get("product_name")}
#         print(f"[INFO] Pareto products loaded: {len(specs)}")
#         return specs
#     except Exception as e:
#         print(f"[WARN] Gagal load pareto products: {e}")
#         return set()


# # ═══════════════════════════════════════════════════════════════════════════════
# # LAST MONTH SNAPSHOT
# # ═══════════════════════════════════════════════════════════════════════════════

# def build_last_month_snapshot(records: List[dict]) -> dict:
#     last_key: dict = {}
#     for r in records:
#         c_id = str(r.get("customer_name", "") or "").strip()
#         if not c_id or c_id == "None": continue
#         try:
#             y, m = int(r.get("sheet_year", 0) or 0), int(r.get("sheet_month", 0) or 0)
#         except: continue
#         if y and m and (c_id not in last_key or (y, m) > last_key[c_id]):
#             last_key[c_id] = (y, m)

#     raw: dict = {}
#     for r in records:
#         c_id = str(r.get("customer_name", "") or "").strip()
#         if not c_id or c_id == "None": continue
#         try:
#             y, m = int(r.get("sheet_year", 0) or 0), int(r.get("sheet_month", 0) or 0)
#         except: continue
#         if (y, m) != last_key.get(c_id): continue

#         spec  = r.get("product_spec")
#         sales = float(r.get("net_sales", 0) or 0)
#         cogs  = float(r.get("cogs", 0) or 0)
#         qty   = safe_qty(r)
#         if not spec or qty <= 0: continue

#         raw.setdefault(c_id, {}).setdefault(spec, {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
#                                                      "family": extract_family(spec)})
#         raw[c_id][spec]["net_sales"] += sales
#         raw[c_id][spec]["cogs"]      += cogs
#         raw[c_id][spec]["qty"]       += qty

#     result = {}
#     for c_id, prods in raw.items():
#         result[c_id] = {"month_key": last_key.get(c_id), "products": {}}
#         for spec, d in prods.items():
#             gm  = calc_gm_pct(d["net_sales"], d["cogs"])
#             asp = d["net_sales"] / d["qty"] if d["qty"] > 0 else 0.0
#             result[c_id]["products"][spec] = {
#                 "spec": spec, "family": d["family"],
#                 "qty":   fmt(d["qty"]),   "sales": fmt(d["net_sales"]),
#                 "cogs":  fmt(d["cogs"]),  "gmPct": fmt(gm), "asp": fmt(asp),
#             }
#     return result


# # ═══════════════════════════════════════════════════════════════════════════════
# # INDEX & LOOKUP BUILDERS
# # ═══════════════════════════════════════════════════════════════════════════════

# def build_global_product_index(records: List[dict], catalog: Dict[str, Dict] = None) -> dict:
#     if catalog is None:
#         catalog = {}

#     raw: dict = {}
#     for r in records:
#         spec  = r.get("product_spec")
#         sales = float(r.get("net_sales", 0) or 0)
#         cogs  = float(r.get("cogs", 0) or 0)
#         qty   = safe_qty(r)
#         if not spec or sales <= 0 or qty <= 0: continue
#         m_key = (r.get("sheet_year"), r.get("sheet_month"))
#         if spec not in raw:
#             raw[spec] = {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
#                          "family": extract_family(spec),
#                          "thickness": extract_thickness_mm(spec), "months_seen": set()}
#         raw[spec]["net_sales"] += sales
#         raw[spec]["cogs"]      += cogs
#         raw[spec]["qty"]       += qty
#         if m_key[0] and m_key[1]: raw[spec]["months_seen"].add(m_key)

#     index = {}
#     for spec, d in raw.items():
#         n = max(len(d["months_seen"]), 1)
#         as_, ac, aq = d["net_sales"]/n, d["cogs"]/n, d["qty"]/n

#         txn_unit_price = as_/aq if aq > 0 else 0.0
#         txn_unit_cogs  = ac /aq if aq > 0 else 0.0

#         cat = catalog.get(spec, {})
#         final_unit_price = cat.get("unit_price") if cat.get("unit_price") is not None else txn_unit_price
#         final_unit_cogs  = cat.get("unit_cogs")  if cat.get("unit_cogs")  is not None else txn_unit_cogs

#         index[spec] = {
#             "family":     d["family"],
#             "thickness":  d["thickness"],
#             "unit_price": final_unit_price,
#             "unit_cogs":  final_unit_cogs,
#             "avg_gm_pct": calc_gm_pct(final_unit_price, final_unit_cogs),
#         }

#     return index


# def build_mapping_lookup(product_mapping: List[dict]) -> Dict[str, List[str]]:
#     lookup: dict = {}
#     for m in sorted(product_mapping, key=lambda x: x.get("mapping_id", 9999)):
#         f, t = m.get("product_name", ""), m.get("to_product_name", "")
#         if not f or not t or f == t: continue
#         lookup.setdefault(f, [])
#         if t not in lookup[f]: lookup[f].append(t)
#     return lookup


# def build_customer_raw(records: List[dict]) -> dict:
#     cust: dict = {}
#     for r in records:
#         c_id  = str(r.get("customer_name", "") or "").strip()
#         spec  = r.get("product_spec")
#         sales = float(r.get("net_sales", 0) or 0)
#         cogs  = float(r.get("cogs", 0) or 0)
#         qty   = safe_qty(r)
#         if not c_id or c_id == "None" or not spec or sales <= 0: continue

#         m_key = (r.get("sheet_year"), r.get("sheet_month"))
#         cust.setdefault(c_id, {"months_seen": set(), "products": {}})
#         if m_key[0] and m_key[1]: cust[c_id]["months_seen"].add(m_key)

#         p = cust[c_id]["products"]
#         p.setdefault(spec, {"net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
#                              "family": extract_family(spec)})
#         p[spec]["net_sales"] += sales
#         p[spec]["cogs"]      += cogs
#         p[spec]["qty"]       += qty
#     return cust


# # ═══════════════════════════════════════════════════════════════════════════════
# # RULE 1 CHECKER
# # ═══════════════════════════════════════════════════════════════════════════════

# def get_customer_product_gm(spec, raw_products, c_months, global_products):
#     if spec in raw_products:
#         p = raw_products[spec]
#         return calc_gm_pct(p["net_sales"]/c_months, p["cogs"]/c_months)
#     return None

# def is_candidate_acceptable(spec, src_gm, raw_products, c_months, global_products):
#     if spec not in global_products: return False
#     gm = get_customer_product_gm(spec, raw_products, c_months, global_products)
#     eff = gm if gm is not None else global_products[spec]["avg_gm_pct"]
#     return eff > src_gm or eff >= TARGET_GM_PCT


# # ═══════════════════════════════════════════════════════════════════════════════
# # RULE 4 SUBSTITUTION
# # ═══════════════════════════════════════════════════════════════════════════════

# def find_family_substitution(source_spec, global_products, allowed_specs: Set[str]):
#     """
#     Cari produk pengganti dalam family yang sama dengan thickness +1mm.
#     FIX v8.4.2: hanya cari dalam allowed_specs (produk yang pernah dibeli customer).
#     """
#     fam, t = extract_family(source_spec), extract_thickness_mm(source_spec)
#     if not fam or t is None: return None
#     target_t = t + 1.0
#     best, best_gm = None, -math.inf
#     for spec, info in global_products.items():
#         if spec not in allowed_specs: continue          # ← FIX v8.4.2
#         if extract_family(spec) != fam: continue
#         th = info.get("thickness") or extract_thickness_mm(spec)
#         if th is None or abs(th - target_t) >= 0.01: continue
#         if info["avg_gm_pct"] > best_gm:
#             best_gm, best = info["avg_gm_pct"], spec
#     return best


# # ═══════════════════════════════════════════════════════════════════════════════
# # LEDGER & SWAP
# # ═══════════════════════════════════════════════════════════════════════════════

# def build_product_ledger(raw_products, c_months):
#     """
#     Fallback: bangun ledger dari historical average.
#     Dipakai jika tidak ada data last month (customer baru).
#     """
#     ledger = {}
#     for spec, d in raw_products.items():
#         as_ = d["net_sales"]/c_months
#         ac  = d["cogs"]/c_months
#         aq  = d["qty"]/c_months
#         ledger[spec] = {
#             "spec": spec, "family": d["family"],
#             "curr_qty": aq, "curr_sales": as_, "curr_cogs": ac,
#             "curr_gm_pct": calc_gm_pct(as_, ac),
#             "proj_qty": aq, "proj_sales": as_, "proj_cogs": ac, "shifts": [],
#         }
#     return ledger


# def build_ledger_from_snapshot(lm_products: dict, gp: dict) -> dict:
#     """
#     v8.4.1: Bangun ledger dari last month QTY × harga standar product_master (via gp).

#     - qty        : last month actuals — baseline paling relevan untuk bulan depan.
#     - unit_price : product_master.average_selling_price (via gp) — harga standar.
#     - unit_cogs  : product_master.cogs_unit (via gp) — COGS standar.
#     - Fallback ke last month actuals jika produk belum ada di product_master.

#     Efek pada retained products (tidak disentuh optimizer):
#       proj_qty == curr_qty == last month qty  →  qtyChange == 0  ✓
#       proj_sales == curr_sales                →  tidak ada perubahan  ✓
#     """
#     ledger = {}
#     for spec, d in lm_products.items():
#         qty = d["qty"]
#         if qty <= 0:
#             continue

#         gp_info = gp.get(spec)
#         if gp_info is not None:
#             unit_price = gp_info["unit_price"]
#             unit_cogs  = gp_info["unit_cogs"]
#         else:
#             unit_price = d["sales"] / qty if qty > 0 else 0.0
#             unit_cogs  = d["cogs"]  / qty if qty > 0 else 0.0
#             print(f"[WARN] {spec} tidak ada di product_master, pakai last month actuals.")

#         sales = unit_price * qty
#         cogs  = unit_cogs  * qty

#         ledger[spec] = {
#             "spec":        spec,
#             "family":      d.get("family", extract_family(spec)),
#             "curr_qty":    qty,
#             "curr_sales":  sales,
#             "curr_cogs":   cogs,
#             "curr_gm_pct": calc_gm_pct(sales, cogs),
#             "proj_qty":    qty,
#             "proj_sales":  sales,
#             "proj_cogs":   cogs,
#             "shifts":      [],
#         }
#     return ledger


# def _ensure_target(ledger, spec, gp):
#     if spec not in ledger:
#         info = gp[spec]
#         ledger[spec] = {"spec": spec, "family": info["family"],
#                         "curr_qty": 0.0, "curr_sales": 0.0, "curr_cogs": 0.0,
#                         "curr_gm_pct": info["avg_gm_pct"],
#                         "proj_qty": 0.0, "proj_sales": 0.0, "proj_cogs": 0.0, "shifts": []}


# def apply_full_swap(ledger, src_spec, tgt_spec, gp):
#     src = ledger.get(src_spec)
#     if src is None or src["proj_qty"] < 1e-6: return None

#     qty       = src["proj_qty"]
#     src_price = src["proj_sales"] / qty if qty > 0 else 0.0

#     src["proj_qty"] = src["proj_sales"] = src["proj_cogs"] = 0.0
#     _ensure_target(ledger, tgt_spec, gp)

#     tgt  = ledger[tgt_spec]
#     info = gp[tgt_spec]
#     tgt["proj_qty"]   += qty
#     tgt["proj_sales"] += info["unit_price"] * qty
#     tgt["proj_cogs"]  += info["unit_cogs"]  * qty

#     move = {
#         "family":           src["family"],
#         "from":             src_spec,
#         "to":               tgt_spec,
#         "shifted_qty":      fmt(qty),
#         "src_unit_price":   fmt(src_price),
#         "sales_from_shift": fmt(info["unit_price"] * qty),
#         "sales_uplift":     fmt((info["unit_price"] - src_price) * qty),
#         "is_partial":       False,
#         "pareto":           False,
#         "retained_qty":     0.0,
#     }
#     src["shifts"].append(move)
#     return move


# def apply_pareto_partial_swap(ledger, src_spec, tgt_spec, gp):
#     src = ledger.get(src_spec)
#     if src is None or src["proj_qty"] < 1e-6: return None

#     total_qty  = src["proj_qty"]
#     keep_qty   = total_qty * PARETO_MIN_QTY_RATIO
#     shift_qty  = total_qty - keep_qty
#     if shift_qty < 1e-6: return None

#     src_price  = src["proj_sales"] / total_qty if total_qty > 0 else 0.0
#     src_cogs_u = src["proj_cogs"]  / total_qty if total_qty > 0 else 0.0

#     src["proj_qty"]   = keep_qty
#     src["proj_sales"] = src_price  * keep_qty
#     src["proj_cogs"]  = src_cogs_u * keep_qty

#     _ensure_target(ledger, tgt_spec, gp)
#     tgt  = ledger[tgt_spec]
#     info = gp[tgt_spec]
#     tgt["proj_qty"]   += shift_qty
#     tgt["proj_sales"] += info["unit_price"] * shift_qty
#     tgt["proj_cogs"]  += info["unit_cogs"]  * shift_qty

#     move = {
#         "family":           src["family"],
#         "from":             src_spec,
#         "to":               tgt_spec,
#         "shifted_qty":      fmt(shift_qty),
#         "src_unit_price":   fmt(src_price),
#         "sales_from_shift": fmt(info["unit_price"] * shift_qty),
#         "sales_uplift":     fmt((info["unit_price"] - src_price) * shift_qty),
#         "is_partial":       True,
#         "pareto":           True,
#         "retained_qty":     fmt(keep_qty),
#     }
#     src["shifts"].append(move)
#     return move


# # ═══════════════════════════════════════════════════════════════════════════════
# # OPTIMIZATION ENGINE
# # ═══════════════════════════════════════════════════════════════════════════════

# def run_optimization_engine(ledger, mapping_lookup, gp, raw_products, c_months, pareto_specs):
#     """
#     FIX v8.4.2: kandidat swap difilter ke ever_bought (produk yang pernah dibeli
#     customer kapanpun). Berlaku untuk mapping_lookup DAN family substitution.

#     ever_bought = set(raw_products.keys()) = semua produk di histori customer
#                   (seluruh periode, bukan hanya last month).
#     """
#     all_moves, exhausted = [], set()
#     visited_pairs: Set[tuple] = set()

#     # Whitelist: semua produk yang pernah dibeli customer kapanpun  ← v8.4.2
#     ever_bought: Set[str] = set(raw_products.keys())

#     for _ in range(len(ledger) * 20):
#         if gm_pct_from_ledger(ledger) >= TARGET_GM_PCT: break

#         worst_spec, worst_gm = None, math.inf
#         for spec, p in ledger.items():
#             if p["proj_qty"] < 1e-6 or spec in exhausted: continue
#             if spec in pareto_specs:
#                 if p["proj_qty"] <= p["curr_qty"] * PARETO_MIN_QTY_RATIO + 1e-6: continue
#             pgm = calc_gm_pct(p["proj_sales"], p["proj_cogs"])
#             if pgm < worst_gm: worst_gm, worst_spec = pgm, spec
#         if worst_spec is None: break

#         # FIX v8.4.2: hanya kandidat yang pernah dibeli customer
#         candidates = [
#             c for c in mapping_lookup.get(worst_spec, [])
#             if (c, worst_spec) not in visited_pairs
#             and c in ever_bought                                        # ← v8.4.2
#         ]

#         chosen = _pick_best_candidate(worst_spec, worst_gm, candidates, raw_products, c_months, gp)

#         # FIX v8.4.2: family substitution juga dibatasi ke ever_bought
#         if chosen is None:
#             fb = find_family_substitution(worst_spec, gp, ever_bought)  # ← v8.4.2
#             if (fb and fb != worst_spec
#                     and (fb, worst_spec) not in visited_pairs
#                     and is_candidate_acceptable(fb, worst_gm, raw_products, c_months, gp)):
#                 chosen = fb

#         if chosen is None:
#             exhausted.add(worst_spec)
#             continue

#         pair = (worst_spec, chosen)
#         if pair in visited_pairs:
#             exhausted.add(worst_spec)
#             continue
#         visited_pairs.add(pair)

#         fn   = apply_pareto_partial_swap if worst_spec in pareto_specs else apply_full_swap
#         move = fn(ledger, worst_spec, chosen, gp)
#         if move:
#             all_moves.append(move)
#         else:
#             exhausted.add(worst_spec)

#     return all_moves


# def _pick_best_candidate(src_spec, src_gm, candidates, raw_products, c_months, gp):
#     t1, t2, t3, t4 = [], [], [], []
#     for cand in candidates:
#         if cand == src_spec or cand not in gp: continue
#         cgm = get_customer_product_gm(cand, raw_products, c_months, gp)
#         ggm = gp[cand]["avg_gm_pct"]
#         if cgm is not None:
#             (t1 if cgm >= TARGET_GM_PCT else t2).append((cand, cgm))
#         else:
#             (t3 if ggm >= TARGET_GM_PCT else t4).append((cand, ggm))
#     for tier in [t1, t2, t3, t4]:
#         if tier: return sorted(tier, key=lambda x: x[1], reverse=True)[0][0]
#     return None


# # ═══════════════════════════════════════════════════════════════════════════════
# # SHIFT CARDS & NEXT MONTH PLAN
# # ═══════════════════════════════════════════════════════════════════════════════

# def aggregate_moves(moves):
#     agg = {}
#     for mv in moves:
#         key = (mv["from"], mv["to"])
#         if key not in agg:
#             agg[key] = mv.copy()
#         else:
#             e = agg[key]
#             e["shifted_qty"]      = fmt(e["shifted_qty"]      + mv["shifted_qty"])
#             e["sales_from_shift"] = fmt(e["sales_from_shift"] + mv["sales_from_shift"])
#             e["sales_uplift"]     = fmt(e["sales_uplift"]     + mv["sales_uplift"])
#             e["is_partial"] = e["is_partial"] or mv["is_partial"]
#             e["pareto"]     = e.get("pareto", False) or mv.get("pareto", False)
#     return list(agg.values())


# def _snap(spec, ledger, gp, projected=False):
#     p = ledger.get(spec)
#     g = gp.get(spec, {})
#     if p is None:
#         return {"qty": 0.0, "sales": 0.0, "cogs": fmt(g.get("unit_cogs", 0)),
#                 "asp": fmt(g.get("unit_price", 0)), "gmPct": fmt(g.get("avg_gm_pct", 0))}
#     qty   = p["proj_qty"]   if projected else p["curr_qty"]
#     sales = p["proj_sales"] if projected else p["curr_sales"]
#     cogs  = p["proj_cogs"]  if projected else p["curr_cogs"]
#     asp   = calc_asp(sales, qty) or fmt(g.get("unit_price", 0))
#     return {"qty": fmt(qty), "sales": fmt(sales), "cogs": fmt(cogs),
#             "asp": fmt(asp), "gmPct": fmt(calc_gm_pct(sales, cogs))}


# def format_shift_cards(agg_moves, ledger, gp):
#     cards = []
#     for mv in agg_moves:
#         fs, ts = mv["from"], mv["to"]
#         fc = _snap(fs, ledger, gp, False)
#         fp = _snap(fs, ledger, gp, True)
#         tc = _snap(ts, ledger, gp, False)
#         tp = _snap(ts, ledger, gp, True)

#         src_asp = mv.get("src_unit_price") or (
#             fc["asp"] if fc["qty"] > 1e-6 else gp.get(fs, {}).get("unit_price", 0)
#         )
#         tgt_asp = gp.get(ts, {}).get("unit_price", tp["asp"])
#         fcu     = gp.get(fs, {}).get("unit_cogs", 0)
#         tpu     = gp.get(ts, {}).get("unit_cogs", 0)

#         cards.append({
#             "shiftId":     f"{fs}__to__{ts}",
#             "family":      mv.get("family", extract_family(fs)),
#             "isPartial":   mv["is_partial"],
#             "isPareto":    mv.get("pareto", False),
#             "swapType":    "pareto_partial" if mv.get("pareto") else "full",
#             "retainedQty": mv.get("retained_qty", 0.0),
#             "fromProduct": {
#                 "spec":      fs,
#                 "family":    ledger.get(fs, {}).get("family", extract_family(fs)),
#                 "current":   fc,
#                 "projected": fp,
#             },
#             "toProduct": {
#                 "spec":      ts,
#                 "family":    ledger.get(ts, {}).get("family", extract_family(ts)),
#                 "current":   tc,
#                 "projected": tp,
#             },
#             "shift": {
#                 "shiftedQty":     mv["shifted_qty"],
#                 "salesFromShift": mv["sales_from_shift"],
#                 "salesUplift":    mv["sales_uplift"],
#             },
#             "delta": {
#                 "asp":         fmt(tgt_asp - src_asp),
#                 "cogsPerUnit": fmt(tpu - fcu),
#                 "gmPct":       fmt(tp["gmPct"] - fc["gmPct"]),
#             },
#         })

#     cards.sort(key=lambda c: c["shift"]["salesUplift"], reverse=True)
#     return cards


# def build_next_month_plan(ledger, gp, pareto_specs, last_mo_prods, shift_cards):
#     shifted_from = {c["fromProduct"]["spec"] for c in shift_cards}
#     shifted_to   = {c["toProduct"]["spec"]   for c in shift_cards}
#     retained, shifted_in, removed = [], [], []

#     for spec, p in ledger.items():
#         ent = {
#             "spec": spec, 
#             "family": p.get("family", extract_family(spec)), 
#             "isPareto": spec in pareto_specs,
            
#             # -- FIX APEL VS JERUK: Data Current murni dari Ledger --
#             "lastMonthQty": fmt(p["curr_qty"]), 
#             "lastMonthSales": fmt(p["curr_sales"]),
#             "lastMonthGmPct": fmt(p["curr_gm_pct"]), 
#             "lastMonthAsp": fmt(calc_asp(p["curr_sales"], p["curr_qty"])),
#             # -------------------------------------------------------
            
#             "projQty": fmt(p["proj_qty"]), 
#             "projSales": fmt(p["proj_sales"]),
#             "projCogs": fmt(p["proj_cogs"]), 
#             "projGmPct": fmt(calc_gm_pct(p["proj_sales"], p["proj_cogs"])),
#             "projAsp": fmt(calc_asp(p["proj_sales"], p["proj_qty"])),
#         }
        
#         # -- FIX BLANK CARDS: Logika append yang kemarin ga sengaja kehapus --
#         if p["proj_qty"] < 1e-6:
#             if spec not in shifted_from: 
#                 removed.append(ent)
#         elif spec in shifted_to and spec not in last_mo_prods:
#             shifted_in.append(ent)
#         else:
#             # Produk "No Change" atau yang Qty-nya diturunin masuk ke sini
#             retained.append({**ent, "qtyChange": fmt(p["proj_qty"] - p["curr_qty"])})

#     retained.sort(key=lambda x: x["projSales"], reverse=True)
#     shifted_in.sort(key=lambda x: x["projSales"], reverse=True)
#     removed.sort(key=lambda x: x["lastMonthSales"], reverse=True)
    
#     return {
#         "retainedProducts": retained,
#         "shiftedInProducts": shifted_in,
#         "removedProducts": removed,
#         "summary": {
#             "retainedCount": len(retained),
#             "shiftedInCount": len(shifted_in),
#             "removedCount": len(removed),
#         },
#     }

# # ═══════════════════════════════════════════════════════════════════════════════
# # AI — ANTHROPIC BATCHES API
# # ═══════════════════════════════════════════════════════════════════════════════

# def _build_batch_request(i: int, cr: dict) -> dict:
#     moves_parts = []
#     for card in cr["shift_cards"][:3]:
#         label = "[PARETO-partial]" if card.get("isPareto") else "[full-swap]"
#         moves_parts.append(
#             f"{card['fromProduct']['spec']}→{card['toProduct']['spec']} "
#             f"{label} qty:{card['shift']['shiftedQty']}, uplift:{card['shift']['salesUplift']:,.0f}"
#         )

#     dynamic_text = (
#         f"Customer: {cr['c_id']}\n"
#         f"GM saat ini: {cr['current_gm_pct']:.1f}% → proyeksi: {cr['projected_gm_pct']:.1f}% "
#         f"(target {TARGET_GM_PCT}%)\n"
#         f"Shift produk: {'; '.join(moves_parts) or 'tidak ada'}\n"
#         f"Produk pareto (wajib jual): {', '.join(cr.get('pareto_in_mix', [])[:3]) or 'tidak ada'}\n"
#         f"Produk upsell potensial: {', '.join(cr.get('upsell_existing', [])[:3]) or 'tidak ada'}"
#     )

#     safe_id   = re.sub(r"[^a-zA-Z0-9]", "-", cr["c_id"])[:48]
#     custom_id = f"cr{i}-{safe_id}"

#     return {
#         "custom_id": custom_id,
#         "params": {
#             "model":       AI_MODEL,
#             "max_tokens":  AI_MAX_TOKENS,
#             "temperature": AI_TEMPERATURE,
#             "system": [
#                 {
#                     "type": "text",
#                     "text": AI_SYSTEM_CONTEXT,
#                     "cache_control": {"type": "ephemeral"},
#                 }
#             ],
#             "messages": [{"role": "user", "content": dynamic_text}],
#         },
#     }


# async def _create_batch_with_backoff(loop, batch_requests: list, chunk_num: int) -> Optional[Any]:
#     for attempt in range(AI_MAX_RETRIES):
#         try:
#             batch = await loop.run_in_executor(
#                 None,
#                 lambda reqs=batch_requests: client.messages.batches.create(requests=reqs),
#             )
#             print(f"[AI Batch] Chunk {chunk_num}: batch created → id={batch.id}")
#             return batch
#         except Exception as e:
#             err_str = str(e)
#             is_rate_limit = ("429" in err_str
#                              or "rate_limit" in err_str.lower()
#                              or "acceleration" in err_str.lower())
#             print(f"[AI Batch] Chunk {chunk_num} create error "
#                   f"(attempt {attempt+1}/{AI_MAX_RETRIES}): {e}")
#             if attempt + 1 >= AI_MAX_RETRIES:
#                 print(f"[AI Batch] Chunk {chunk_num}: semua retry habis, skip.")
#                 return None
#             ra = _parse_retry_after(e) if is_rate_limit else None
#             await _backoff_sleep(attempt, ra)
#     return None


# async def _retrieve_results(loop, batch_id: str, chunk_num: int) -> Dict[str, str]:
#     try:
#         items = await loop.run_in_executor(
#             None, lambda bid=batch_id: list(client.messages.batches.results(bid))
#         )
#         results: Dict[str, str] = {}
#         for item in items:
#             if item.result.type == "succeeded":
#                 results[item.custom_id] = item.result.message.content[0].text
#             else:
#                 err_type = getattr(getattr(item.result, "error", None), "type", "unknown")
#                 results[item.custom_id] = f"AI batch error: {err_type}"
#         print(f"[AI Batch] Chunk {chunk_num}: {len(results)} results retrieved.")
#         return results
#     except Exception as e:
#         print(f"[AI Batch] Chunk {chunk_num} retrieve error: {e}")
#         return {}


# async def generate_ai_reasoning_batch(customer_results: list) -> List[str]:
#     final = ["GM sudah optimal. Pertahankan mix produk saat ini."] * len(customer_results)

#     if not client or not os.environ.get("ANTHROPIC_API_KEY"):
#         return ["AI reasoning tidak tersedia (API Key tidak diset)."] * len(customer_results)

#     all_requests: List[dict] = []
#     needs_ai: List[tuple]    = []
#     for i, cr in enumerate(customer_results):
#         if cr["status"] == "Needs Optimization" and cr["shift_cards"]:
#             req = _build_batch_request(i, cr)
#             all_requests.append({
#                 "index":     i,
#                 "custom_id": req["custom_id"],
#                 "params":    req["params"],
#             })
#             needs_ai.append((i, req["custom_id"]))

#     if not all_requests:
#         print("[AI Batch] Tidak ada customer yang butuh AI reasoning.")
#         return final

#     chunks = [
#         all_requests[s:s + AI_BATCH_CHUNK_SIZE]
#         for s in range(0, len(all_requests), AI_BATCH_CHUNK_SIZE)
#     ]
#     total_chunks = len(chunks)
#     print(f"[AI Batch] {len(all_requests)} requests → {total_chunks} chunk(s) "
#           f"(chunk_size={AI_BATCH_CHUNK_SIZE})")

#     loop = asyncio.get_running_loop()

#     # ── PHASE 1: Submit semua chunks ─────────────────────────────────────────
#     submitted: List[Optional[Any]]    = []
#     chunk_custom_ids: List[List[str]] = []

#     for chunk_idx, chunk in enumerate(chunks):
#         chunk_num = chunk_idx + 1
#         batch_requests = [{"custom_id": r["custom_id"], "params": r["params"]} for r in chunk]
#         chunk_custom_ids.append([r["custom_id"] for r in chunk])

#         batch = await _create_batch_with_backoff(loop, batch_requests, chunk_num)
#         submitted.append(batch)

#         if batch is None:
#             print(f"[AI Batch] Chunk {chunk_num}: gagal submit, akan di-skip.")
#         else:
#             print(f"[AI Batch] Chunk {chunk_num}/{total_chunks} submitted → {batch.id}")

#         if chunk_idx < total_chunks - 1 and AI_BATCH_SUBMIT_DELAY_SEC > 0:
#             print(f"[AI Batch] Submit delay {AI_BATCH_SUBMIT_DELAY_SEC}s ...")
#             await asyncio.sleep(AI_BATCH_SUBMIT_DELAY_SEC)

#     # ── PHASE 2: Poll SEMUA batch secara paralel ──────────────────────────────
#     async def poll_and_retrieve(batch_obj, chunk_idx: int) -> Dict[str, str]:
#         if batch_obj is None:
#             return {cid: "AI batch chunk gagal dibuat." for cid in chunk_custom_ids[chunk_idx]}

#         chunk_num = chunk_idx + 1
#         await asyncio.sleep(chunk_idx * AI_BATCH_POLL_JITTER_SEC)

#         elapsed = 0
#         while elapsed < AI_BATCH_MAX_WAIT:
#             await asyncio.sleep(AI_BATCH_POLL_SEC)
#             elapsed += AI_BATCH_POLL_SEC
#             try:
#                 status_obj = await loop.run_in_executor(
#                     None, lambda bid=batch_obj.id: client.messages.batches.retrieve(bid)
#                 )
#                 c = status_obj.request_counts
#                 print(f"[AI Batch] Chunk {chunk_num} | {elapsed}s | "
#                       f"{status_obj.processing_status} | "
#                       f"ok={c.succeeded} err={c.errored} proc={c.processing}")
#                 if status_obj.processing_status == "ended":
#                     return await _retrieve_results(loop, batch_obj.id, chunk_num)
#             except Exception as e:
#                 print(f"[AI Batch] Chunk {chunk_num} poll error: {e}")

#         print(f"[AI Batch] Chunk {chunk_num}: timeout {AI_BATCH_MAX_WAIT}s.")
#         return {
#             cid: f"AI reasoning timeout (>{AI_BATCH_MAX_WAIT}s)."
#             for cid in chunk_custom_ids[chunk_idx]
#         }

#     poll_results_list = await asyncio.gather(
#         *[poll_and_retrieve(batch_obj, idx) for idx, batch_obj in enumerate(submitted)]
#     )

#     results_map: Dict[str, str] = {}
#     for chunk_results in poll_results_list:
#         results_map.update(chunk_results)

#     for i, custom_id in needs_ai:
#         final[i] = results_map.get(custom_id, f"Hasil AI tidak ditemukan (idx={i}).")

#     ok = sum(1 for _, cid in needs_ai
#              if cid in results_map and not results_map[cid].startswith("AI"))
#     print(f"[AI Batch] Selesai: {ok}/{len(needs_ai)} sukses.")
#     return final


# # ═══════════════════════════════════════════════════════════════════════════════
# # SUPABASE CHUNKED UPSERT
# # ═══════════════════════════════════════════════════════════════════════════════

# def supabase_upsert_chunked(table, payload, chunk_size=SUPABASE_CHUNK):
#     if not supabase_client or not payload: return
#     for i in range(0, len(payload), chunk_size):
#         try: supabase_client.table(table).upsert(payload[i:i+chunk_size]).execute()
#         except Exception as e: print(f"Error upsert chunk {i}: {e}")


# # ═══════════════════════════════════════════════════════════════════════════════
# # MAIN ENDPOINT
# # ═══════════════════════════════════════════════════════════════════════════════

# @app.post("/simulate")
# async def simulate_product_mix(payload: SimulateRequest):
#     t0 = time.time()
#     records, product_mapping = payload.data, payload.product_mapping or []

#     if not records:
#         raise HTTPException(status_code=400, detail="No valid data array found in payload")

#     if not product_mapping and supabase_client:
#         try:
#             res = supabase_client.table("view_product_related").select("*").order("priority").execute()
#             product_mapping = res.data or []
#         except Exception as e:
#             print(f"Gagal load product_mapping: {e}")

#     product_catalog = load_product_catalog()
#     pareto_specs    = load_pareto_products()
#     gp              = build_global_product_index(records, catalog=product_catalog)
#     base_mapping    = build_mapping_lookup(product_mapping)
#     customer_raw    = build_customer_raw(records)
#     last_month_all  = build_last_month_snapshot(records)

#     print(f"[INFO] records={len(records)} | customers={len(customer_raw)} | "
#           f"global_products={len(gp)} | pareto_specs={len(pareto_specs)} | "
#           f"catalog_products={len(product_catalog)}")

#     # ── Kalkulasi (sync) ──────────────────────────────────────────────────────
#     customer_results = []
#     for c_id, raw in customer_raw.items():
#         c_months = max(len(raw["months_seen"]), 1)

#         # Ambil last month snapshot untuk customer ini
#         c_lm          = last_month_all.get(c_id, {})
#         c_lm_products = c_lm.get("products", {})
#         c_lm_key      = c_lm.get("month_key")

#         # Baseline ledger: last month qty × harga product_master  (v8.4.1)
#         # Fallback ke historical avg jika tidak ada data last month (customer baru)
#         if c_lm_products:
#             ledger = build_ledger_from_snapshot(c_lm_products, gp)
#         else:
#             print(f"[WARN] {c_id}: tidak ada data last month, fallback ke historical average.")
#             ledger = build_product_ledger(raw["products"], c_months)

#         tcs = sum(p["curr_sales"] for p in ledger.values())
#         tcc = sum(p["curr_cogs"]  for p in ledger.values())
#         tcq = sum(p["curr_qty"]   for p in ledger.values())
#         cgm = calc_gm_pct(tcs, tcc)

#         local_map = {k: list(v) for k, v in base_mapping.items()}

#         # Optimizer: raw["products"] sebagai whitelist ever_bought  (v8.4.2)
#         raw_moves = (
#             run_optimization_engine(ledger, local_map, gp, raw["products"], c_months, pareto_specs)
#             if cgm < TARGET_GM_PCT else []
#         )

#         agg_moves   = aggregate_moves(raw_moves)
#         shift_cards = format_shift_cards(agg_moves, ledger, gp)

#         tps = sum(p["proj_sales"] for p in ledger.values())
#         tpc = sum(p["proj_cogs"]  for p in ledger.values())
#         tpq = sum(p["proj_qty"]   for p in ledger.values())
#         pgm = calc_gm_pct(tps, tpc)

#         nmp = build_next_month_plan(ledger, gp, pareto_specs, c_lm_products, shift_cards)

#         customer_results.append({
#             "c_id":             c_id,
#             "c_months":         c_months,
#             "c_last_month_key": c_lm_key,
#             "shift_cards":      shift_cards,
#             "next_month_plan":  nmp,
#             "upsell_existing": [
#                 s for s, p in ledger.items()
#                 if p["curr_gm_pct"] >= TARGET_GM_PCT and p["curr_qty"] > 0
#             ],
#             "reduce_or_renegotiate": [
#                 s for s, p in ledger.items()
#                 if p["curr_gm_pct"] < TARGET_GM_PCT
#                 and p["proj_qty"] >= p["curr_qty"] - 1e-6
#                 and p["curr_qty"] > 0
#             ],
#             "pareto_in_mix": [
#                 s for s in ledger if s in pareto_specs and ledger[s]["curr_qty"] > 0
#             ],
#             "current_gm_pct":   cgm,
#             "projected_gm_pct": pgm,
#             "total_curr_sales": tcs,
#             "total_curr_cogs":  tcc,
#             "total_curr_qty":   tcq,
#             "total_proj_sales": tps,
#             "total_proj_cogs":  tpc,
#             "total_proj_qty":   tpq,
#             "status": "On Target" if cgm >= TARGET_GM_PCT else "Needs Optimization",
#         })

#     t1 = time.time()
#     print(f"[PERF] Kalkulasi selesai: {t1-t0:.2f}s")

#     # ── AI via Batches API ────────────────────────────────────────────────────
#     ai_reasonings = await generate_ai_reasoning_batch(customer_results)
#     t2 = time.time()
#     print(f"[PERF] AI Batch selesai: {t2-t1:.2f}s | Total: {t2-t0:.2f}s")

#     # ── Assemble response ─────────────────────────────────────────────────────
#     recommendations, db_payload = [], []
#     for cr, ai_r in zip(customer_results, ai_reasonings):
#         lmk = cr["c_last_month_key"]
#         lml = f"{lmk[0]}-{str(lmk[1]).zfill(2)}" if lmk else "unknown"

#         rec = {
#             "customerId":       cr["c_id"],
#             "historicalMonths": cr["c_months"],
#             "lastMonthRef":     lml,
#             "currentPerformance": {
#                 "nettSales":    fmt(cr["total_curr_sales"]),
#                 "currentQty":   fmt(cr["total_curr_qty"]),
#                 "currentGmPct": fmt(cr["current_gm_pct"]),
#                 "status":       cr["status"],
#             },
#             "projectedPerformance": {
#                 "projectedSales": fmt(cr["total_proj_sales"]),
#                 "projectedQty":   fmt(cr["total_proj_qty"]),
#                 "projectedGmPct": fmt(cr["projected_gm_pct"]),
#                 "targetGmPct":    TARGET_GM_PCT,
#                 "improvement":    fmt(cr["projected_gm_pct"] - cr["current_gm_pct"]),
#             },
#             "nextMonthPlan": cr["next_month_plan"],
#             "productMixStrategy": {
#                 "paretoInMix":         cr["pareto_in_mix"],
#                 "reduceOrRenegotiate": cr["reduce_or_renegotiate"],
#                 "upsellExisting":      cr["upsell_existing"],
#                 "shiftCards":          cr["shift_cards"],
#                 "aiReasoning":         ai_r,
#             },
#         }
#         recommendations.append(rec)
#         db_payload.append({
#             "customer_id":           cr["c_id"],
#             "historical_months":     cr["c_months"],
#             "last_month_ref":        lml,
#             "current_performance":   rec["currentPerformance"],
#             "projected_performance": rec["projectedPerformance"],
#             "next_month_plan":       cr["next_month_plan"],
#             "pareto_in_mix":         cr["pareto_in_mix"],
#             "shift_cards":           cr["shift_cards"],
#             "ai_reasoning":          ai_r,
#         })

#     recommendations.sort(key=lambda x: x["currentPerformance"]["currentGmPct"])
#     # supabase_upsert_chunked("customer_strategies", db_payload)

#     total_chunks_used = math.ceil(
#         sum(1 for cr in customer_results
#             if cr["status"] == "Needs Optimization" and cr["shift_cards"])
#         / AI_BATCH_CHUNK_SIZE
#     ) if any(cr["status"] == "Needs Optimization" for cr in customer_results) else 0

#     return {
#         "metadata": {
#             "version":               "8.4.2",
#             "totalCustomers":        len(recommendations),
#             "paretoProducts":        len(pareto_specs),
#             "catalogProducts":       len(product_catalog),
#             "aiMode":                "batches_api_submit_all_poll_parallel",
#             "aiModel":               AI_MODEL,
#             "aiBatchChunkSize":      AI_BATCH_CHUNK_SIZE,
#             "aiBatchChunksUsed":     total_chunks_used,
#             "aiBatchSubmitDelaySec": AI_BATCH_SUBMIT_DELAY_SEC,
#             "calcTimeSec":           round(t1-t0, 2),
#             "aiTimeSec":             round(t2-t1, 2),
#             "totalTimeSec":          round(t2-t0, 2),
#         },
#         "recommendations": recommendations,
#     }


# @app.get("/health")
# def health():
#     return {
#         "status":                "ok",
#         "version":               "8.4.2",
#         "ai_mode":               "Anthropic Batches API — submit-all, poll-parallel, backoff-protected",
#         "ai_model":              AI_MODEL,
#         "ai_batch_chunk_size":   AI_BATCH_CHUNK_SIZE,
#         "ai_batch_submit_delay": f"{AI_BATCH_SUBMIT_DELAY_SEC}s",
#         "ai_batch_poll_sec":     AI_BATCH_POLL_SEC,
#         "ai_batch_max_wait":     f"{AI_BATCH_MAX_WAIT}s",
#         "ai_max_retries":        AI_MAX_RETRIES,
#         "ai_backoff_max_sec":    AI_BACKOFF_MAX_SEC,
#         "pareto_min_qty_ratio":  PARETO_MIN_QTY_RATIO,
#         "supabase_connected":    supabase_client is not None,
#     }
