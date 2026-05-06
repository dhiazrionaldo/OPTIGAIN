"""
OptiGain AI Product Mix Simulator — v7.0.0
Revamp dari v6.1.0

Perubahan utama:
  - FIXED Rule 1: Cek historis customer — apakah produk target pernah dibeli?
                  Kalau sudah dibeli, cek GM% produk itu di customer (min TARGET_GM_PCT).
                  Kalau belum dibeli, pakai global avg_gm_pct sebagai penilaian.
  - FIXED Rule 2: Qty shift = qty produk original (1:1 full swap, bukan partial).
                  Jika ada sisa produk lain yang belum diswap, lanjut ke produk berikutnya.
  - FIXED Rule 4: Fallback substitusi dalam family yang sama, ketebalan +1mm dari original.
  - PERF  Rule 5: Hapus AI_BATCH_DELAY, paralel semua customer sekaligus dengan semaphore,
                  prompt lebih pendek, timeout per customer.
"""

import os
import asyncio
import math
import time
import re
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, List, Dict, Optional
import anthropic

app = FastAPI(title="OptiGain AI Product Mix Simulator", version="7.0.0")

TARGET_GM_PCT   = 9.0    # target global gross margin %
SUPABASE_CHUNK  = 50     # baris per upsert batch

# AI config — paralel dengan semaphore, tanpa batch delay
AI_MAX_RETRIES    = 2
AI_RETRY_DELAY    = 8.0   # detik flat retry delay (bukan exponential)
AI_CONCURRENCY    = 6     # max customer diproses AI secara bersamaan
AI_TIMEOUT_SEC    = 25.0  # timeout per AI call

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


# ── Request Model ─────────────────────────────────────────────────────────────
class SimulateRequest(BaseModel):
    data: List[Any]
    product_mapping: Optional[List[Dict]] = []


# ═══════════════════════════════════════════════════════════════════════════════
# PURE HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def fmt(value) -> float:
    try:
        return round(float(value), 2)
    except Exception:
        return 0.0


def extract_family(spec: str) -> str:
    if not spec:
        return "Unknown"
    return spec.split(" ")[0].strip()


def extract_thickness_mm(spec: str) -> Optional[float]:
    """
    Ekstrak angka ketebalan dari spec string.
    Contoh: 'FL 5 mm' -> 5.0, 'FL 5,5 mm' -> 5.5
    """
    if not spec:
        return None
    match = re.search(r'(\d+(?:[.,]\d+)?)\s*mm', spec, re.IGNORECASE)
    if match:
        raw = match.group(1).replace(',', '.')
        try:
            return float(raw)
        except ValueError:
            return None
    # fallback: cari angka setelah spasi pertama
    parts = spec.strip().split()
    if len(parts) >= 2:
        raw = parts[1].replace(',', '.')
        try:
            return float(raw)
        except ValueError:
            return None
    return None


def safe_qty(record: dict) -> float:
    raw = (record.get("qty") or record.get("Qty") or record.get("quantity")
           or record.get("Quantity") or record.get("QTY") or 0)
    try:
        return float(raw)
    except (ValueError, TypeError):
        return 0.0


def calc_gm_pct(sales: float, cogs: float) -> float:
    if sales <= 0:
        return 0.0
    return (sales - cogs) / sales * 100.0


def gm_pct_from_ledger(ledger: dict) -> float:
    total_sales = sum(p["proj_sales"] for p in ledger.values())
    total_cogs  = sum(p["proj_cogs"]  for p in ledger.values())
    return calc_gm_pct(total_sales, total_cogs)


def calc_asp(sales: float, qty: float) -> float:
    if qty > 1e-6:
        return round(sales / qty, 2)
    return 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# AGGREGATE MOVES
# ═══════════════════════════════════════════════════════════════════════════════

def aggregate_moves(all_moves: List[dict]) -> List[dict]:
    aggregated: Dict[tuple, dict] = {}
    for move in all_moves:
        key = (move["from"], move["to"])
        if key not in aggregated:
            aggregated[key] = move.copy()
        else:
            existing = aggregated[key]
            existing["shifted_qty"]      = fmt(existing["shifted_qty"]      + move["shifted_qty"])
            existing["sales_from_shift"] = fmt(existing["sales_from_shift"] + move["sales_from_shift"])
            existing["sales_uplift"]     = fmt(existing["sales_uplift"]     + move["sales_uplift"])
            existing["is_partial"]       = existing["is_partial"] or move["is_partial"]
    return list(aggregated.values())


# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL PRODUCT INDEX BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_global_product_index(records: List[dict]) -> dict:
    raw: dict = {}
    for r in records:
        spec  = r.get("product_spec")
        sales = float(r.get("net_sales", 0) or 0)
        cogs  = float(r.get("cogs", 0) or 0)
        qty   = safe_qty(r)

        if not spec or sales <= 0 or qty <= 0:
            continue

        m_key = (r.get("sheet_year"), r.get("sheet_month"))

        if spec not in raw:
            raw[spec] = {
                "net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
                "family": extract_family(spec),
                "thickness": extract_thickness_mm(spec),
                "months_seen": set()
            }

        raw[spec]["net_sales"] += sales
        raw[spec]["cogs"]      += cogs
        raw[spec]["qty"]       += qty
        if m_key[0] and m_key[1]:
            raw[spec]["months_seen"].add(m_key)

    index: dict = {}
    for spec, d in raw.items():
        n         = max(len(d["months_seen"]), 1)
        avg_sales = d["net_sales"] / n
        avg_cogs  = d["cogs"] / n
        avg_qty   = d["qty"] / n
        index[spec] = {
            "family":     d["family"],
            "thickness":  d["thickness"],
            "unit_price": avg_sales / avg_qty if avg_qty > 0 else 0.0,
            "unit_cogs":  avg_cogs  / avg_qty if avg_qty > 0 else 0.0,
            "avg_gm_pct": calc_gm_pct(avg_sales, avg_cogs),
        }
    return index


# ═══════════════════════════════════════════════════════════════════════════════
# MAPPING LOOKUP BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_mapping_lookup(product_mapping: List[dict]) -> Dict[str, List[str]]:
    sorted_mapping = sorted(product_mapping, key=lambda m: m.get("mapping_id", 9999))
    lookup: dict = {}
    for m in sorted_mapping:
        from_name = m.get("product_name", "")
        to_name   = m.get("to_product_name", "")
        if not from_name or not to_name:
            continue
        if from_name == to_name:
            continue
        lookup.setdefault(from_name, [])
        if to_name not in lookup[from_name]:
            lookup[from_name].append(to_name)
    return lookup


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER RAW DATA BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_customer_raw(records: List[dict]) -> dict:
    cust: dict = {}
    for r in records:
        c_id  = str(r.get("customer_name", "") or "").strip()
        spec  = r.get("product_spec")
        sales = float(r.get("net_sales", 0) or 0)
        cogs  = float(r.get("cogs", 0) or 0)
        qty   = safe_qty(r)

        if not c_id or c_id == "None" or not spec or sales <= 0:
            continue

        m_key = (r.get("sheet_year"), r.get("sheet_month"))

        cust.setdefault(c_id, {"months_seen": set(), "products": {}})
        if m_key[0] and m_key[1]:
            cust[c_id]["months_seen"].add(m_key)

        prods = cust[c_id]["products"]
        prods.setdefault(spec, {
            "net_sales": 0.0, "cogs": 0.0, "qty": 0.0,
            "family": extract_family(spec)
        })
        prods[spec]["net_sales"] += sales
        prods[spec]["cogs"]      += cogs
        prods[spec]["qty"]       += qty

    return cust


# ═══════════════════════════════════════════════════════════════════════════════
# CUSTOMER-LEVEL PRODUCT PERFORMANCE CHECKER (Rule 1)
# ═══════════════════════════════════════════════════════════════════════════════

def get_customer_product_gm(
    target_spec: str,
    raw_products: dict,
    c_months: int,
    global_products: dict,
) -> Optional[float]:
    """
    Rule 1: Cek GM% produk target di customer ini.
    - Jika produk pernah dibeli customer → return GM% aktual customer.
    - Jika belum pernah → return None (akan pakai global avg_gm_pct).
    """
    if target_spec in raw_products:
        p = raw_products[target_spec]
        avg_s = p["net_sales"] / c_months
        avg_c = p["cogs"] / c_months
        return calc_gm_pct(avg_s, avg_c)
    return None  # produk belum pernah dibeli customer


def is_candidate_acceptable(
    target_spec: str,
    source_gm_pct: float,
    raw_products: dict,
    c_months: int,
    global_products: dict,
) -> bool:
    """
    Kandidat acceptable jika:
    1. Punya data di global_products
    2. GM%-nya (customer atau global) lebih baik dari source, ATAU >= TARGET_GM_PCT
    """
    if target_spec not in global_products:
        return False

    cust_gm = get_customer_product_gm(target_spec, raw_products, c_months, global_products)
    # Pakai GM% customer jika pernah dibeli, kalau tidak pakai global
    effective_gm = cust_gm if cust_gm is not None else global_products[target_spec]["avg_gm_pct"]

    return effective_gm > source_gm_pct or effective_gm >= TARGET_GM_PCT


# ═══════════════════════════════════════════════════════════════════════════════
# FAMILY SUBSTITUTION FINDER (Rule 4)
# ═══════════════════════════════════════════════════════════════════════════════

def find_family_substitution(
    source_spec: str,
    global_products: dict,
) -> Optional[str]:
    """
    Rule 4: Cari substitusi dalam family yang sama, ketebalan +1mm dari source.
    Contoh: FL 5 mm → cari FL 6 mm
    """
    src_family    = extract_family(source_spec)
    src_thickness = extract_thickness_mm(source_spec)

    if src_family is None or src_thickness is None:
        return None

    target_thickness = src_thickness + 1.0
    best_spec = None
    best_gm   = -math.inf

    for spec, info in global_products.items():
        if extract_family(spec) != src_family:
            continue
        t = info.get("thickness") or extract_thickness_mm(spec)
        if t is None:
            continue
        # Tepat +1mm
        if abs(t - target_thickness) < 0.01:
            if info["avg_gm_pct"] > best_gm:
                best_gm   = info["avg_gm_pct"]
                best_spec = spec

    return best_spec


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCT LEDGER BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_product_ledger(raw_products: dict, c_months: int) -> dict:
    ledger: dict = {}
    for spec, d in raw_products.items():
        avg_sales = d["net_sales"] / c_months
        avg_cogs  = d["cogs"]      / c_months
        avg_qty   = d["qty"]       / c_months
        gm_pct    = calc_gm_pct(avg_sales, avg_cogs)

        ledger[spec] = {
            "spec":        spec,
            "family":      d["family"],
            "curr_qty":    avg_qty,
            "curr_sales":  avg_sales,
            "curr_cogs":   avg_cogs,
            "curr_gm_pct": gm_pct,
            "proj_qty":    avg_qty,
            "proj_sales":  avg_sales,
            "proj_cogs":   avg_cogs,
            "shifts":      [],
        }
    return ledger


# ═══════════════════════════════════════════════════════════════════════════════
# APPLY SHIFT — Rule 2: qty shift = FULL qty produk source (1:1 swap)
# ═══════════════════════════════════════════════════════════════════════════════

def apply_full_swap(
    ledger: dict,
    source_spec: str,
    target_spec: str,
    global_products: dict,
) -> Optional[dict]:
    """
    Rule 2: Swap FULL qty source_spec ke target_spec.
    qty_shift = proj_qty source (seluruhnya, bukan partial).
    """
    src = ledger.get(source_spec)
    if src is None or src["proj_qty"] < 1e-6:
        return None

    qty = src["proj_qty"]  # FULL qty — Rule 2

    src_price  = src["proj_sales"] / qty if qty > 0 else 0.0
    src_cogs_u = src["proj_cogs"]  / qty if qty > 0 else 0.0

    delta_sales_src = src_price  * qty
    delta_cogs_src  = src_cogs_u * qty

    # Kurangi source sepenuhnya
    src["proj_qty"]   = 0.0
    src["proj_sales"] = 0.0
    src["proj_cogs"]  = 0.0

    # Tambah ke target
    tgt_info = global_products[target_spec]
    if target_spec not in ledger:
        ledger[target_spec] = {
            "spec":        target_spec,
            "family":      tgt_info["family"],
            "curr_qty":    0.0,
            "curr_sales":  0.0,
            "curr_cogs":   0.0,
            "curr_gm_pct": tgt_info["avg_gm_pct"],
            "proj_qty":    0.0,
            "proj_sales":  0.0,
            "proj_cogs":   0.0,
            "shifts":      [],
        }

    tgt = ledger[target_spec]
    delta_sales_tgt = tgt_info["unit_price"] * qty
    delta_cogs_tgt  = tgt_info["unit_cogs"]  * qty
    tgt["proj_qty"]   += qty
    tgt["proj_sales"] += delta_sales_tgt
    tgt["proj_cogs"]  += delta_cogs_tgt

    move_info = {
        "family":           src["family"],
        "from":             source_spec,
        "to":               target_spec,
        "shifted_qty":      fmt(qty),
        "sales_from_shift": fmt(delta_sales_tgt),
        "sales_uplift":     fmt(delta_sales_tgt - delta_sales_src),
        "is_partial":       False,  # always full swap (Rule 2)
    }
    src["shifts"].append(move_info)
    return move_info


# ═══════════════════════════════════════════════════════════════════════════════
# OPTIMIZATION ENGINE — Rule 1 + Rule 2 + Rule 4
# ═══════════════════════════════════════════════════════════════════════════════

def run_optimization_engine(
    ledger: dict,
    mapping_lookup: dict,
    global_products: dict,
    raw_products: dict,   # untuk Rule 1 historical check
    c_months: int,
) -> List[dict]:
    """
    Iterasi sampai GM >= target atau tidak ada lagi produk yang bisa diswap.

    Prioritas kandidat (Rule 1):
    1. Produk yang pernah dibeli customer & GM% customer >= TARGET
    2. Produk yang pernah dibeli customer & GM% customer > source GM%
    3. Produk yang belum pernah dibeli & global GM% >= TARGET
    4. Produk yang belum pernah dibeli & global GM% > source GM%
    5. Rule 4: family sama, +1mm thickness

    Swap: full qty (Rule 2)
    """
    all_moves: List[dict] = []
    exhausted_specs = set()
    max_iterations  = len(ledger) * 20  # safety cap

    for _ in range(max_iterations):
        current_gm = gm_pct_from_ledger(ledger)
        if current_gm >= TARGET_GM_PCT:
            break

        # Cari produk paling buruk GM% yang masih bisa diswap
        worst_spec = None
        worst_gm   = math.inf

        for spec, p in ledger.items():
            if p["proj_qty"] < 1e-6:
                continue
            if spec in exhausted_specs:
                continue
            p_gm = calc_gm_pct(p["proj_sales"], p["proj_cogs"])
            if p_gm < worst_gm:
                worst_gm   = p_gm
                worst_spec = spec

        if worst_spec is None:
            break

        # Pilih kandidat terbaik berdasarkan Rule 1 + Rule 4
        candidates = list(mapping_lookup.get(worst_spec, []))
        chosen = _pick_best_candidate(
            worst_spec, worst_gm, candidates,
            raw_products, c_months, global_products
        )

        # Rule 4: fallback family substitution jika tidak ada dari mapping
        if chosen is None:
            fallback = find_family_substitution(worst_spec, global_products)
            if fallback and fallback != worst_spec:
                if is_candidate_acceptable(
                    fallback, worst_gm, raw_products, c_months, global_products
                ):
                    chosen = fallback

        if chosen is None:
            exhausted_specs.add(worst_spec)
            continue

        # Rule 2: full swap
        move = apply_full_swap(ledger, worst_spec, chosen, global_products)
        if move:
            all_moves.append(move)
        else:
            exhausted_specs.add(worst_spec)

    return all_moves


def _pick_best_candidate(
    source_spec: str,
    source_gm_pct: float,
    candidates: List[str],
    raw_products: dict,
    c_months: int,
    global_products: dict,
) -> Optional[str]:
    """
    Prioritas pemilihan kandidat (Rule 1):
    Tier 1: Pernah dibeli customer, GM% customer >= TARGET
    Tier 2: Pernah dibeli customer, GM% customer > source GM%
    Tier 3: Belum pernah dibeli, global GM% >= TARGET
    Tier 4: Belum pernah dibeli, global GM% > source GM%
    """
    tier1, tier2, tier3, tier4 = [], [], [], []

    for cand in candidates:
        if cand == source_spec:
            continue
        if cand not in global_products:
            continue

        cust_gm = get_customer_product_gm(cand, raw_products, c_months, global_products)
        glob_gm = global_products[cand]["avg_gm_pct"]
        bought  = cust_gm is not None

        if bought:
            if cust_gm >= TARGET_GM_PCT:
                tier1.append((cand, cust_gm))
            elif cust_gm > source_gm_pct:
                tier2.append((cand, cust_gm))
        else:
            if glob_gm >= TARGET_GM_PCT:
                tier3.append((cand, glob_gm))
            elif glob_gm > source_gm_pct:
                tier4.append((cand, glob_gm))

    # Ambil yang terbaik di tier tertinggi
    for tier in [tier1, tier2, tier3, tier4]:
        if tier:
            tier.sort(key=lambda x: x[1], reverse=True)
            return tier[0][0]

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# SHIFT CARD BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def get_product_snapshot(
    spec: str,
    ledger: dict,
    global_products: dict,
    use_projected: bool = False,
) -> dict:
    p  = ledger.get(spec)
    gp = global_products.get(spec, {})

    if p is None:
        unit_price = fmt(gp.get("unit_price", 0.0))
        unit_cogs  = fmt(gp.get("unit_cogs",  0.0))
        gm_pct     = fmt(gp.get("avg_gm_pct", 0.0))
        return {"qty": 0.0, "sales": 0.0, "cogs": unit_cogs, "asp": unit_price, "gmPct": gm_pct}

    if use_projected:
        qty   = p["proj_qty"]
        sales = p["proj_sales"]
        cogs  = p["proj_cogs"]
    else:
        qty   = p["curr_qty"]
        sales = p["curr_sales"]
        cogs  = p["curr_cogs"]

    asp = calc_asp(sales, qty)
    if asp == 0.0:
        asp = fmt(gp.get("unit_price", 0.0))

    return {
        "qty":   fmt(qty),
        "sales": fmt(sales),
        "cogs":  fmt(cogs),
        "asp":   fmt(asp),
        "gmPct": fmt(calc_gm_pct(sales, cogs)),
    }


def format_shift_cards(
    aggregated_moves: List[dict],
    ledger: dict,
    global_products: dict,
) -> List[dict]:
    cards = []
    for move in aggregated_moves:
        from_spec = move["from"]
        to_spec   = move["to"]

        from_p = ledger.get(from_spec, {})
        to_p   = ledger.get(to_spec,   {})

        from_current   = get_product_snapshot(from_spec, ledger, global_products, use_projected=False)
        from_projected = get_product_snapshot(from_spec, ledger, global_products, use_projected=True)
        to_current     = get_product_snapshot(to_spec,   ledger, global_products, use_projected=False)
        to_projected   = get_product_snapshot(to_spec,   ledger, global_products, use_projected=True)

        from_cogs_per_unit = (
            from_current["cogs"] / from_current["qty"]
            if from_current["qty"] > 1e-6
            else global_products.get(from_spec, {}).get("unit_cogs", 0.0)
        )
        to_cogs_per_unit = (
            to_projected["cogs"] / to_projected["qty"]
            if to_projected["qty"] > 1e-6
            else global_products.get(to_spec, {}).get("unit_cogs", 0.0)
        )

        delta_asp           = fmt(to_projected["asp"]   - from_current["asp"])
        delta_cogs_per_unit = fmt(to_cogs_per_unit      - from_cogs_per_unit)
        delta_gm_pct        = fmt(to_projected["gmPct"] - from_current["gmPct"])

        cards.append({
            "shiftId":   f"{from_spec}__to__{to_spec}",
            "family":    move.get("family", extract_family(from_spec)),
            "isPartial": move["is_partial"],
            "swapType":  "full",  # Rule 2: selalu full swap

            "fromProduct": {
                "spec":      from_spec,
                "family":    from_p.get("family", extract_family(from_spec)),
                "current":   from_current,
                "projected": from_projected,
            },
            "toProduct": {
                "spec":      to_spec,
                "family":    to_p.get("family", extract_family(to_spec)),
                "current":   to_current,
                "projected": to_projected,
            },
            "shift": {
                "shiftedQty":     fmt(move["shifted_qty"]),
                "salesFromShift": fmt(move["sales_from_shift"]),
                "salesUplift":    fmt(move["sales_uplift"]),
            },
            "delta": {
                "asp":          delta_asp,
                "cogsPerUnit":  delta_cogs_per_unit,
                "gmPct":        delta_gm_pct,
            },
        })

    cards.sort(key=lambda c: c["shift"]["salesUplift"], reverse=True)
    return cards


# ═══════════════════════════════════════════════════════════════════════════════
# AI REASONING — paralel dengan semaphore, tanpa batch delay
# ═══════════════════════════════════════════════════════════════════════════════

_ai_semaphore: Optional[asyncio.Semaphore] = None

def get_ai_semaphore() -> asyncio.Semaphore:
    global _ai_semaphore
    if _ai_semaphore is None:
        _ai_semaphore = asyncio.Semaphore(AI_CONCURRENCY)
    return _ai_semaphore


async def generate_ai_reasoning_single(
    customer_id: str,
    current_gm: float,
    projected_gm: float,
    shift_cards: list,
    upsell_products: list,
) -> str:
    if not client or not os.environ.get("ANTHROPIC_API_KEY"):
        return "AI reasoning tidak tersedia (API Key tidak diset)."

    # Prompt ringkas — lebih cepat
    moves_parts = []
    for card in shift_cards[:3]:
        moves_parts.append(
            f"{card['fromProduct']['spec']}→{card['toProduct']['spec']} "
            f"(qty:{card['shift']['shiftedQty']}, uplift:{card['shift']['salesUplift']:,.0f})"
        )
    moves_text  = "; ".join(moves_parts) or "tidak ada shift"
    upsell_text = ", ".join(upsell_products[:3]) or "tidak ada"

    prompt = (
        f"Sales advisor kaca. Rekomendasi singkat untuk tim sales.\n"
        f"Customer: {customer_id}\n"
        f"GM: {current_gm:.1f}% → proyeksi {projected_gm:.1f}% (target {TARGET_GM_PCT}%)\n"
        f"Shift: {moves_text}\n"
        f"Upsell: {upsell_text}\n\n"
        f"Berikan 3 aksi konkrit (bahasa Indonesia, max 150 kata, tanpa sebut angka margin internal)."
    )

    sem = get_ai_semaphore()
    async with sem:
        for attempt in range(AI_MAX_RETRIES):
            try:
                loop = asyncio.get_running_loop()
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: client.messages.create(
                            model="claude-haiku-4-5",
                            max_tokens=300,
                            temperature=0.3,
                            messages=[{"role": "user", "content": prompt}],
                        )
                    ),
                    timeout=AI_TIMEOUT_SEC,
                )
                return response.content[0].text

            except asyncio.TimeoutError:
                print(f"[AI] Timeout {customer_id} attempt {attempt+1}")
                if attempt < AI_MAX_RETRIES - 1:
                    await asyncio.sleep(AI_RETRY_DELAY)
                else:
                    return f"AI reasoning timeout. GM proyeksi: {projected_gm:.1f}%."

            except anthropic.RateLimitError:
                if attempt < AI_MAX_RETRIES - 1:
                    await asyncio.sleep(AI_RETRY_DELAY)
                else:
                    return f"AI reasoning rate limit. GM proyeksi: {projected_gm:.1f}%."

            except Exception as e:
                print(f"[AI ERROR] {customer_id}: {e}")
                return f"Gagal generate AI reasoning: {str(e)}"

    return "AI reasoning tidak berhasil."


async def generate_ai_reasoning_all(customer_results: list) -> List[str]:
    """
    Proses SEMUA customer secara paralel dengan semaphore (max AI_CONCURRENCY).
    """
    # ✅ Helper coroutine pengganti asyncio.coroutine (dihapus di Python 3.11)
    async def _already_optimal() -> str:
        return "GM sudah optimal. Pertahankan mix produk saat ini."

    tasks = []
    for cr in customer_results:
        if cr["status"] == "Needs Optimization" and cr["shift_cards"]:
            tasks.append(
                generate_ai_reasoning_single(
                    cr["c_id"],
                    cr["current_gm_pct"],
                    cr["projected_gm_pct"],
                    cr["shift_cards"],
                    cr["upsell_existing"],
                )
            )
        else:
            tasks.append(_already_optimal())  # ✅ langsung pakai async def

    print(f"[AI] Memproses {len(tasks)} customer secara paralel (max {AI_CONCURRENCY} concurrent)...")
    results = await asyncio.gather(*tasks, return_exceptions=True)

    final = []
    for r in results:
        if isinstance(r, Exception):
            final.append(f"Error: {str(r)}")
        else:
            final.append(r)
    return final

# ═══════════════════════════════════════════════════════════════════════════════
# SUPABASE CHUNKED UPSERT
# ═══════════════════════════════════════════════════════════════════════════════

def supabase_upsert_chunked(table: str, payload: list, chunk_size: int = SUPABASE_CHUNK):
    if not supabase_client or not payload:
        return
    for i in range(0, len(payload), chunk_size):
        chunk = payload[i:i + chunk_size]
        try:
            supabase_client.table(table).upsert(chunk).execute()
        except Exception as e:
            print(f"Error upsert chunk {i}: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/simulate")
async def simulate_product_mix(payload: SimulateRequest):
    t0 = time.time()
    records         = payload.data
    product_mapping = payload.product_mapping or []

    if not records:
        raise HTTPException(status_code=400, detail="No valid data array found in payload")

    # Load mapping dari Supabase kalau tidak ada di payload
    if not product_mapping and supabase_client:
        try:
            result = (
                supabase_client.table("view_product_related")
                .select("*")
                .order("priority")
                .execute()
            )
            product_mapping = result.data or []
        except Exception as e:
            print(f"Gagal load product_mapping: {e}")

    # Build index & lookup
    global_products = build_global_product_index(records)
    base_mapping    = build_mapping_lookup(product_mapping)
    customer_raw    = build_customer_raw(records)

    print(f"[INFO] records={len(records)} | customers={len(customer_raw)} | global_products={len(global_products)}")

    # Kalkulasi semua customer (sync, pure Python)
    customer_results = []

    for c_id, raw in customer_raw.items():
        c_months = max(len(raw["months_seen"]), 1)
        ledger   = build_product_ledger(raw["products"], c_months)

        total_curr_sales = sum(p["curr_sales"] for p in ledger.values())
        total_curr_cogs  = sum(p["curr_cogs"]  for p in ledger.values())
        total_curr_qty   = sum(p["curr_qty"]   for p in ledger.values())
        current_gm_pct   = calc_gm_pct(total_curr_sales, total_curr_cogs)

        local_mapping = {k: list(v) for k, v in base_mapping.items()}
        raw_moves: List[dict] = []

        if current_gm_pct < TARGET_GM_PCT:
            raw_moves = run_optimization_engine(
                ledger, local_mapping, global_products,
                raw["products"], c_months   # Rule 1: pass raw_products & c_months
            )

        all_moves   = aggregate_moves(raw_moves)
        shift_cards = format_shift_cards(all_moves, ledger, global_products)

        total_proj_sales = sum(p["proj_sales"] for p in ledger.values())
        total_proj_cogs  = sum(p["proj_cogs"]  for p in ledger.values())
        total_proj_qty   = sum(p["proj_qty"]   for p in ledger.values())
        projected_gm_pct = calc_gm_pct(total_proj_sales, total_proj_cogs)

        upsell_existing = [
            spec for spec, p in ledger.items()
            if p["curr_gm_pct"] >= TARGET_GM_PCT and p["curr_qty"] > 0
        ]
        reduce_or_renegotiate = [
            spec for spec, p in ledger.items()
            if p["curr_gm_pct"] < TARGET_GM_PCT
            and p["proj_qty"] >= p["curr_qty"] - 1e-6
            and p["curr_qty"] > 0
        ]

        status = "On Target" if current_gm_pct >= TARGET_GM_PCT else "Needs Optimization"

        customer_results.append({
            "c_id":                  c_id,
            "c_months":              c_months,
            "ledger":                ledger,
            "all_moves":             all_moves,
            "shift_cards":           shift_cards,
            "upsell_existing":       upsell_existing,
            "reduce_or_renegotiate": reduce_or_renegotiate,
            "current_gm_pct":        current_gm_pct,
            "projected_gm_pct":      projected_gm_pct,
            "total_curr_sales":      total_curr_sales,
            "total_curr_cogs":       total_curr_cogs,
            "total_curr_qty":        total_curr_qty,
            "total_proj_sales":      total_proj_sales,
            "total_proj_cogs":       total_proj_cogs,
            "total_proj_qty":        total_proj_qty,
            "status":                status,
        })

    t1 = time.time()
    print(f"[PERF] Kalkulasi selesai: {t1-t0:.2f}s")

    # Generate AI reasoning — paralel semua customer
    ai_reasonings = await generate_ai_reasoning_all(customer_results)

    t2 = time.time()
    print(f"[PERF] AI selesai: {t2-t1:.2f}s | Total: {t2-t0:.2f}s")

    # Assemble response
    recommendations = []
    db_payload      = []

    for cr, ai_reasoning in zip(customer_results, ai_reasonings):
        rec = {
            "customerId":       cr["c_id"],
            "historicalMonths": cr["c_months"],

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

            "productMixStrategy": {
                "reduceOrRenegotiate": cr["reduce_or_renegotiate"],
                "upsellExisting":      cr["upsell_existing"],
                "shiftCards":          cr["shift_cards"],
                "aiReasoning":         ai_reasoning,
            },
        }
        recommendations.append(rec)

        db_payload.append({
            "customer_id":           cr["c_id"],
            "historical_months":     cr["c_months"],
            "current_performance":   rec["currentPerformance"],
            "projected_performance": rec["projectedPerformance"],
            "reduce_or_renegotiate": cr["reduce_or_renegotiate"],
            "upsell_existing":       cr["upsell_existing"],
            "shift_cards":           cr["shift_cards"],
            "ai_reasoning":          ai_reasoning,
        })

    recommendations.sort(key=lambda x: x["currentPerformance"]["currentGmPct"])

    # Simpan ke Supabase (chunked) — uncomment jika dibutuhkan
    # supabase_upsert_chunked("customer_strategies", db_payload)

    return {"recommendations": recommendations}


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status":             "ok",
        "version":            "7.0.0",
        "rule1_historical":   "check customer history before recommending product",
        "rule2_qty_swap":     "full qty swap (1:1, no partial shift)",
        "rule4_substitution": "family same +1mm thickness fallback",
        "rule5_performance":  f"parallel AI (semaphore={AI_CONCURRENCY}), no batch delay, timeout={AI_TIMEOUT_SEC}s",
        "ai_model":           "claude-haiku-4-5",
        "supabase_connected": supabase_client is not None,
    }
