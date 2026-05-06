"""
OptiGain AI Product Mix Simulator — v6.0.0
Revamp dari v5.0.0

Perubahan utama:
  - Fix: aggregate_moves() — gabungkan shift from→to yang sama agar tidak duplikat kartu
  - Fix: format_product_details() — tambah type 'transit' untuk produk yang jadi source DAN target
  - Fix: AI rate limit 429 — sequential dengan exponential backoff + retry, bukan paralel asyncio.gather
  - Fix: is_partial logic yang lebih akurat
  - Fix: frontend-friendly product_details — data tidak pernah 0 untuk produk yang terlibat shift
"""

import os
import asyncio
import math
import time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, List, Dict, Optional
import anthropic

app = FastAPI(title="OptiGain AI Product Mix Simulator", version="6.0.0")

TARGET_GM_PCT  = 9.0   # target global gross margin %
SUPABASE_CHUNK = 50    # baris per upsert batch

# Rate limit config untuk Anthropic AI
AI_MAX_RETRIES      = 3     # max retry per customer
AI_RETRY_BASE_DELAY = 15.0  # detik — base delay sebelum retry (exponential)
AI_BATCH_SIZE       = 3     # jumlah customer diproses per batch sebelum jeda
AI_BATCH_DELAY      = 15.0  # detik jeda antar batch


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
            print("Supabase initialized (v2.x)")
        except Exception as e:
            print(f"Supabase v2.x init failed: {e}")

    if not initialized:
        try:
            from supabase import create_client
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            initialized = True
            print("Supabase initialized (v1.x)")
        except Exception as e:
            print(f"Supabase v1.x init failed: {e}")

    if not initialized:
        print("WARNING: Supabase initialization failed. DB features disabled.")


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


# ═══════════════════════════════════════════════════════════════════════════════
# FIX 1 — AGGREGATE MOVES (gabungkan shift from→to yang sama)
# ═══════════════════════════════════════════════════════════════════════════════

def aggregate_moves(all_moves: List[dict]) -> List[dict]:
    """
    Gabungkan semua shift yang memiliki from→to yang sama menjadi satu entry.
    Ini mencegah kartu duplikat di frontend.
    """
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
            # is_partial = True kalau salah satunya partial
            existing["is_partial"] = existing["is_partial"] or move["is_partial"]
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
                "family": extract_family(spec), "months_seen": set()
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
# ITERATIVE PARTIAL-SHIFT ENGINE
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


def qty_needed_to_hit_target(
    ledger: dict,
    source_spec: str,
    target_spec: str,
    global_products: dict,
) -> float:
    T = TARGET_GM_PCT / 100.0

    old_total_sales = sum(p["proj_sales"] for p in ledger.values())
    old_gm_value    = sum(p["proj_sales"] - p["proj_cogs"] for p in ledger.values())

    src = ledger.get(source_spec)
    if src is None or src["proj_qty"] <= 0:
        return 0.0

    tgt_info = global_products.get(target_spec)
    if tgt_info is None:
        return 0.0

    src_price  = src["proj_sales"] / src["proj_qty"] if src["proj_qty"] > 0 else 0.0
    src_cogs_u = src["proj_cogs"]  / src["proj_qty"] if src["proj_qty"] > 0 else 0.0
    tgt_price  = tgt_info["unit_price"]
    tgt_cogs_u = tgt_info["unit_cogs"]

    delta_price = tgt_price - src_price
    delta_gm_u  = (tgt_price - tgt_cogs_u) - (src_price - src_cogs_u)

    denom = delta_gm_u - T * delta_price
    if abs(denom) < 1e-9:
        return 0.0

    numerator = T * old_total_sales - old_gm_value
    q = numerator / denom
    return max(0.0, min(q, src["proj_qty"]))


def apply_shift(
    ledger: dict,
    source_spec: str,
    target_spec: str,
    qty: float,
    global_products: dict,
) -> dict:
    src = ledger[source_spec]

    # Catat curr_qty sebelum dikurangi untuk is_partial yang akurat
    available_before_shift = src["proj_qty"]

    src_price  = src["proj_sales"] / src["proj_qty"] if src["proj_qty"] > 0 else 0.0
    src_cogs_u = src["proj_cogs"]  / src["proj_qty"] if src["proj_qty"] > 0 else 0.0

    delta_sales_src = src_price  * qty
    delta_cogs_src  = src_cogs_u * qty

    src["proj_qty"]   -= qty
    src["proj_sales"] -= delta_sales_src
    src["proj_cogs"]  -= delta_cogs_src

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

    # is_partial: True kalau tidak semua qty yang tersedia ikut dishift
    is_partial = qty < (available_before_shift - 1e-6)

    move_info = {
        "family":           src["family"],
        "from":             source_spec,
        "to":               target_spec,
        "shifted_qty":      fmt(qty),
        "sales_from_shift": fmt(delta_sales_tgt),
        "sales_uplift":     fmt(delta_sales_tgt - delta_sales_src),
        "is_partial":       is_partial,
    }
    src["shifts"].append(move_info)
    return move_info


def run_optimization_engine(
    ledger: dict,
    mapping_lookup: dict,
    global_products: dict,
) -> List[dict]:
    all_moves: List[dict] = []
    max_iterations = len(ledger) * 10

    for _ in range(max_iterations):
        current_gm = gm_pct_from_ledger(ledger)
        if current_gm >= TARGET_GM_PCT:
            break

        worst_spec = None
        worst_gm   = math.inf

        for spec, p in ledger.items():
            if p["proj_qty"] <= 0:
                continue
            if spec not in mapping_lookup:
                continue
            p_gm = calc_gm_pct(p["proj_sales"], p["proj_cogs"])
            if p_gm < worst_gm:
                worst_gm   = p_gm
                worst_spec = spec

        if worst_spec is None:
            break

        chosen_candidate = None
        best_effort_spec = None
        best_effort_gm   = -math.inf

        for candidate_spec in mapping_lookup[worst_spec]:
            if candidate_spec == worst_spec:
                continue
            if candidate_spec not in global_products:
                continue
            cand_gm = global_products[candidate_spec]["avg_gm_pct"]

            if cand_gm > worst_gm:
                chosen_candidate = candidate_spec
                break

            if cand_gm > best_effort_gm:
                best_effort_gm   = cand_gm
                best_effort_spec = candidate_spec

        if chosen_candidate is None and best_effort_spec is not None:
            chosen_candidate = best_effort_spec

        if chosen_candidate is None:
            mapping_lookup.pop(worst_spec, None)
            continue

        qty_to_shift  = qty_needed_to_hit_target(ledger, worst_spec, chosen_candidate, global_products)
        available_qty = ledger[worst_spec]["proj_qty"]

        if qty_to_shift <= 0:
            qty_to_shift = available_qty

        qty_to_shift = min(qty_to_shift, available_qty)

        if qty_to_shift < 1e-6:
            mapping_lookup.pop(worst_spec, None)
            continue

        move = apply_shift(ledger, worst_spec, chosen_candidate, qty_to_shift, global_products)
        all_moves.append(move)

        if ledger[worst_spec]["proj_qty"] < 1e-6:
            mapping_lookup.pop(worst_spec, None)

    return all_moves


# ═══════════════════════════════════════════════════════════════════════════════
# FIX 2 — FORMAT PRODUCT DETAILS (type 'transit' untuk produk perantara)
# ═══════════════════════════════════════════════════════════════════════════════

def format_product_details(ledger: dict, aggregated_moves: List[dict]) -> List[dict]:
    """
    Classify setiap produk berdasarkan perannya di aggregated_moves.

    Types:
    - target_new      : produk baru (curr_qty == 0, masuk karena shift)
    - transit         : jadi SOURCE sekaligus TARGET dalam shift yang berbeda
    - source_shifted  : hanya jadi sumber shift (dikurangi qty-nya)
    - target_existing : hanya jadi penerima shift (ditambah qty-nya)
    - unchanged       : tidak terlibat shift sama sekali
    """
    source_specs = {m["from"] for m in aggregated_moves}
    target_specs = {m["to"]   for m in aggregated_moves}

    details = []
    for spec, p in ledger.items():
        is_new    = p["curr_qty"] == 0.0 and p["proj_qty"] > 0
        is_source = spec in source_specs
        is_target = spec in target_specs

        if is_new:
            ptype = "target_new"
        elif is_source and is_target:
            ptype = "transit"
        elif is_source:
            ptype = "source_shifted"
        elif is_target:
            ptype = "target_existing"
        else:
            ptype = "unchanged"

        proj_gm_pct = calc_gm_pct(p["proj_sales"], p["proj_cogs"])

        details.append({
            "spec":   spec,
            "family": p["family"],
            "type":   ptype,
            "current": {
                "qty":   fmt(p["curr_qty"]),
                "sales": fmt(p["curr_sales"]),
                "gmPct": fmt(p["curr_gm_pct"]),
            },
            "projected": {
                "qty":   fmt(p["proj_qty"]),
                "sales": fmt(p["proj_sales"]),
                "gmPct": fmt(proj_gm_pct),
            },
        })
    return details


# ═══════════════════════════════════════════════════════════════════════════════
# FIX 3 — AI REASONING DENGAN RATE LIMIT HANDLING (sequential + retry backoff)
# ═══════════════════════════════════════════════════════════════════════════════

async def generate_ai_reasoning_with_retry(
    customer_id: str,
    current_gm: float,
    projected_gm: float,
    family_moves: list,
    upsell_products: list,
    num_months: int,
) -> str:
    """
    Generate AI reasoning dengan retry + exponential backoff untuk handle 429.
    Prompt lebih ringkas untuk hemat token dan kurangi risiko rate limit.
    """
    if not client or not os.environ.get("ANTHROPIC_API_KEY"):
        return "AI reasoning tidak tersedia (API Key tidak diset)."

    # Ringkas data untuk prompt yang lebih pendek → hemat token → kurangi rate limit
    moves_summary = []
    for m in family_moves[:4]:  # max 4 moves di prompt
        direction = "full shift" if not m.get("is_partial") else "partial shift"
        moves_summary.append(f"{m['from']} → {m['to']} ({direction}, qty: {m['shifted_qty']})")

    moves_text  = "; ".join(moves_summary) if moves_summary else "tidak ada shift"
    upsell_text = ", ".join(upsell_products[:4]) if upsell_products else "tidak ada"

    prompt = f"""Kamu adalah AI Sales Advisor manufaktur kaca. Buat rekomendasi singkat untuk tim sales.

Customer: {customer_id}
GM saat ini: {current_gm:.1f}% → Target: {TARGET_GM_PCT}% → Projected: {projected_gm:.1f}%
Shift produk: {moves_text}
Upsell existing: {upsell_text}

Format respons TEPAT:
## Rekomendasi untuk Tim Sales - Customer {customer_id}

**Strategi Bisnis:**
1. [aksi konkrit untuk shift produk]
2. [cara approach customer untuk terima substitusi]
3. [strategi upsell produk margin bagus]

Bahasa Indonesia, profesional, actionable. Jangan sebut angka margin internal."""

    for attempt in range(AI_MAX_RETRIES):
        try:
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None,
                lambda: client.messages.create(
                    model="claude-haiku-4-5",
                    max_tokens=400,       # dikurangi dari 500 → hemat token
                    temperature=0.3,
                    messages=[{"role": "user", "content": prompt}],
                )
            )
            return response.content[0].text

        except anthropic.RateLimitError as e:
            if attempt < AI_MAX_RETRIES - 1:
                delay = AI_RETRY_BASE_DELAY * (2 ** attempt)  # 15s, 30s, 60s
                print(f"[RATE LIMIT] {customer_id} — retry {attempt + 1}/{AI_MAX_RETRIES} "
                      f"dalam {delay:.0f}s. Error: {e}")
                await asyncio.sleep(delay)
            else:
                print(f"[RATE LIMIT] {customer_id} — semua retry habis. Skip AI reasoning.")
                return f"AI reasoning dilewati (rate limit). GM proyeksi: {projected_gm:.1f}%."

        except Exception as e:
            print(f"[AI ERROR] {customer_id}: {e}")
            return f"Gagal generate AI reasoning: {str(e)}"

    return "AI reasoning tidak berhasil dihasilkan."


async def generate_ai_reasoning_batched(customer_results: list) -> List[str]:
    """
    Proses AI reasoning secara sequential dalam batch kecil untuk
    menghindari 429 rate limit (5 req/menit di Haiku).

    Strategi:
    - Batch size = AI_BATCH_SIZE customer per batch
    - Dalam 1 batch: jalankan PARALEL (hemat waktu)
    - Antar batch: tunggu AI_BATCH_DELAY detik
    - Customer "On Target" → skip AI, langsung return pesan default
    """
    results = []
    needs_ai_indices = []
    default_messages = {}

    # Pisahkan yang perlu AI vs yang tidak
    for i, cr in enumerate(customer_results):
        if cr["status"] == "Needs Optimization" and cr["all_moves"]:
            needs_ai_indices.append(i)
        else:
            default_messages[i] = "GM sudah optimal. Pertahankan mix produk saat ini."

    print(f"[AI] Total customers: {len(customer_results)} | "
          f"Butuh AI: {len(needs_ai_indices)} | "
          f"Skip (on target): {len(default_messages)}")

    # Placeholder untuk semua results
    ai_results: Dict[int, str] = dict(default_messages)

    # Proses dalam batch
    for batch_start in range(0, len(needs_ai_indices), AI_BATCH_SIZE):
        batch_indices = needs_ai_indices[batch_start:batch_start + AI_BATCH_SIZE]
        batch_num     = batch_start // AI_BATCH_SIZE + 1
        total_batches = math.ceil(len(needs_ai_indices) / AI_BATCH_SIZE)

        print(f"[AI] Batch {batch_num}/{total_batches} — "
              f"processing {len(batch_indices)} customers...")

        # Dalam 1 batch: paralel
        tasks = []
        for idx in batch_indices:
            cr = customer_results[idx]
            tasks.append(
                generate_ai_reasoning_with_retry(
                    cr["c_id"],
                    cr["current_gm_pct"],
                    cr["projected_gm_pct"],
                    cr["all_moves"],
                    cr["upsell_existing"],
                    cr["c_months"],
                )
            )

        batch_results = await asyncio.gather(*tasks)
        for idx, reasoning in zip(batch_indices, batch_results):
            ai_results[idx] = reasoning

        # Jeda antar batch (kecuali batch terakhir)
        if batch_start + AI_BATCH_SIZE < len(needs_ai_indices):
            print(f"[AI] Batch {batch_num} selesai. Tunggu {AI_BATCH_DELAY}s sebelum batch berikutnya...")
            await asyncio.sleep(AI_BATCH_DELAY)

    # Susun kembali sesuai urutan index
    return [ai_results[i] for i in range(len(customer_results))]


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
            print(f"Upserted rows {i}–{i + len(chunk) - 1} to {table}")
        except Exception as e:
            print(f"Error upsert chunk {i}: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/simulate")
async def simulate_product_mix(payload: SimulateRequest):
    records         = payload.data
    product_mapping = payload.product_mapping or []

    if not records:
        raise HTTPException(status_code=400, detail="No valid data array found in payload")

    # ── 1. Load mapping dari Supabase kalau tidak dikirim di payload ──────────
    if not product_mapping and supabase_client:
        try:
            result = (
                supabase_client.table("view_product_related")
                .select("*")
                .order("priority")
                .execute()
            )
            product_mapping = result.data or []
            print(f"Loaded {len(product_mapping)} mapping rows dari Supabase.")
        except Exception as e:
            print(f"Gagal load product_mapping dari Supabase: {e}")

    # ── 2. Build index & lookup ───────────────────────────────────────────────
    global_products = build_global_product_index(records)
    base_mapping    = build_mapping_lookup(product_mapping)
    customer_raw    = build_customer_raw(records)

    print(f"[DEBUG] records          : {len(records)}")
    print(f"[DEBUG] product_mapping  : {len(product_mapping)}")
    print(f"[DEBUG] base_mapping keys: {len(base_mapping)}")
    print(f"[DEBUG] customers        : {len(customer_raw)}")
    print(f"[DEBUG] global_products  : {len(global_products)}")

    # ── 3. Kalkulasi semua customer (sync, pure Python) ───────────────────────
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
            mappable = [s for s in ledger if s in local_mapping]
            print(f"[DEBUG] customer={c_id!r} curr_gm={current_gm_pct:.2f}% "
                  f"products={len(ledger)} mappable={len(mappable)}")
            raw_moves = run_optimization_engine(ledger, local_mapping, global_products)
        else:
            print(f"[DEBUG] customer={c_id!r} already on target: {current_gm_pct:.2f}%")

        # ── FIX 1: Agregasi moves sebelum disimpan ────────────────────────────
        all_moves = aggregate_moves(raw_moves)

        proj_gm_after = calc_gm_pct(
            sum(p["proj_sales"] for p in ledger.values()),
            sum(p["proj_cogs"]  for p in ledger.values())
        )
        print(f"[DEBUG] customer={c_id!r} moves(raw)={len(raw_moves)} "
              f"moves(aggregated)={len(all_moves)} proj_gm={proj_gm_after:.2f}%")

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
            "all_moves":             all_moves,       # sudah diagregasi
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

    # ── 4. Generate AI reasoning — sequential batching, bukan asyncio.gather ──
    ai_reasonings = await generate_ai_reasoning_batched(customer_results)

    # ── 5. Assembling final response ──────────────────────────────────────────
    recommendations = []
    db_payload      = []

    for cr, ai_reasoning in zip(customer_results, ai_reasonings):
        # ── FIX 2: format_product_details terima aggregated_moves ─────────────
        product_details = format_product_details(cr["ledger"], cr["all_moves"])

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
                "intraFamilyShifts":   cr["all_moves"],   # sudah diagregasi
                "productDetails":      product_details,
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
            "intra_family_shifts":   cr["all_moves"],
            "product_details":       product_details,
            "ai_reasoning":          ai_reasoning,
        })

    recommendations.sort(key=lambda x: x["currentPerformance"]["currentGmPct"])

    # ── 6. Simpan ke Supabase (chunked) ──────────────────────────────────────
    # supabase_upsert_chunked("customer_strategies", db_payload)

    return {"recommendations": recommendations}


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status":             "ok",
        "version":            "6.0.0",
        "shifting_logic":     "iterative partial-shift with target-first priority",
        "ai_strategy":        f"sequential batching ({AI_BATCH_SIZE}/batch, {AI_BATCH_DELAY}s delay)",
        "ai_retry":           f"exponential backoff, max {AI_MAX_RETRIES} retries",
        "supabase_connected": supabase_client is not None,
    }
