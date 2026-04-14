import re

# --- keyword maps ---

KPI_KEYWORDS = {
    "reach": "reach",
    "viewers": "reach",
    "who watched": "reach",
    "daily reach": "reach",
    "penetration": "penetration",
    "subscriber": "penetration",
    "subscribe": "penetration",
    "subscription": "penetration",
    "how many subscribe": "penetration",
    "spend": "spend",
    "spending": "spend",
    "arpu": "spend",
    "how much do people pay": "spend",
    "how much do people spend": "spend",
    "viewing time": "viewing_time",
    "how long": "viewing_time",
    "minutes": "viewing_time",
    "time spent": "viewing_time",
    "watch time": "viewing_time",
    "churn": "churn_intention",
    "cancel": "churn_intention",
    "cancellation": "churn_intention",
    "stacking": "stacking",
    "how many services": "stacking",
    "number of subscriptions": "stacking",
    "account sharing": "account_sharing",
    "sharing": "account_sharing",
    "gross access": "gross_access",
}

# sorted longest-first so "how much do people spend" matches before "spend"
_KPI_PATTERNS = sorted(KPI_KEYWORDS.keys(), key=len, reverse=True)

SERVICE_MAP = {
    "netflix": "netflix",
    "hbo max": "hbo_max",
    "hbo": "hbo_max",
    "max": "hbo_max",
    "disney+": "disney",
    "disney plus": "disney",
    "disney": "disney",
    "viaplay": "viaplay",
    "prime video": "prime",
    "prime": "prime",
    "amazon": "prime",
    "youtube": "youtube",
    "tiktok": "tiktok",
    "instagram": "instagram",
    "tv4 play": "tv4_play",
    "tv4": "tv4_play",
    "svt play": "svt_play",
    "svt": "svt_play",
    "nrk": "nrk",
    "tv2 play": "tv2_play_no",
    "tv 2 play": "tv2_play_no",
    "discovery+": "discovery",
    "discovery": "discovery",
    "skyshowtime": "skyshowtime",
    "apple tv": "apple_tv",
    "cmore": "cmore",
    "c more": "cmore",
    "dr": "dr",
    "yle areena": "yle_areena",
    "yle": "yle_areena",
    "snapchat": "snapchat",
    "twitch": "twitch",
    "facebook": "facebook",
    "pluto tv": "pluto_tv",
    "dazn": "dazn",
}
_SERVICE_PATTERNS = sorted(SERVICE_MAP.keys(), key=len, reverse=True)

COUNTRY_MAP = {
    "sweden": "sweden", "swedish": "sweden", "sverige": "sweden", "se": "sweden",
    "norway": "norway", "norwegian": "norway", "norge": "norway", "no": "norway",
    "denmark": "denmark", "danish": "denmark", "danmark": "denmark", "dk": "denmark",
    "finland": "finland", "finnish": "finland", "suomi": "finland", "fi": "finland",
}

DIMENSION_KEYWORDS = {
    "svod": "svod",
    "s-svod": "ssvod", "ssvod": "ssvod", "standalone svod": "ssvod",
    "b-svod": "bsvod", "bsvod": "bsvod", "bundled svod": "bsvod",
    "hvod": "hvod", "hybrid": "hvod",
    "social": "social", "social media": "social", "social video": "social",
    "online total": "online_total", "all online": "online_total",
    "online excluding social": "online_excluding_social", "non-social": "online_excluding_social",
    "public service": "public_service",
    "avod": "avod", "ad-supported": "avod",
    "fast": "fast",
    "genre": "genre",
}
VIDEO_TYPE_KEYWORDS = [
    "video type", "video types", "by type", "different types",
    "by video type", "type of video", "types of video",
]

_DIM_PATTERNS = sorted(DIMENSION_KEYWORDS.keys(), key=len, reverse=True)

CATEGORY_KEYWORDS = {
    "tv": "tv", "linear tv": "tv", "broadcast": "tv", "free-to-air": "tv",
    "radio": "radio",
    "podcast": "podcast",
    "music": "music",
    "cinema": "cinema",
}
_CAT_PATTERNS = sorted(CATEGORY_KEYWORDS.keys(), key=len, reverse=True)

# default kpi_dimension per kpi_type
KPI_DIMENSION_DEFAULTS = {
    "penetration": "svod",
    "reach": "online_total",
    "viewing_time": None,
    "spend": "ssvod",
    "churn_intention": "svod",
    "stacking": "svod",
    "account_sharing": None,
    "gross_access": "svod",
}

# kpi_dimension→inferred kpi_type (reverse lookup) — static fallback only
DIMENSION_TO_KPI = {
    "svod": "penetration", "ssvod": "penetration", "bsvod": "penetration", "hvod": "penetration",
    "social": "reach", "online_total": "reach", "online_excluding_social": "reach",
    "public_service": "reach",
    "genre": "reach",
    "avod": "penetration", "fast": "reach",
}

_dynamic_dim_to_kpi = None


def set_dimension_to_kpi(mapping):
    global _dynamic_dim_to_kpi
    _dynamic_dim_to_kpi = mapping
    print(f"[intent] using dynamic dim_to_kpi ({len(mapping)} entries)")

# household-level kpis (weight by population_household)
HOUSEHOLD_KPIS = {"penetration", "spend", "churn_intention", "stacking", "account_sharing", "gross_access"}
# individual-level kpis (weight by population or population_1574)
INDIVIDUAL_KPIS = {"reach", "viewing_time"}

ALL_COUNTRIES = ["sweden", "norway", "denmark", "finland"]

# display names for preamble
KPI_DISPLAY = {
    "penetration": "penetration",
    "reach": "reach",
    "viewing_time": "viewing time",
    "spend": "spend",
    "churn_intention": "churn intention",
    "stacking": "service stacking",
    "account_sharing": "account sharing",
    "gross_access": "gross access",
}

DIMENSION_DISPLAY = {
    "svod": "SVOD",
    "ssvod": "standalone SVOD",
    "bsvod": "bundled SVOD",
    "hvod": "HVOD",
    "social": "social video",
    "online_total": "online total",
    "online_excluding_social": "online excl. social",
    "public_service": "public service",
    "avod": "AVOD",
    "fast": "FAST",
    "genre": "genre",
}

# metric switch suggestions: kpi→related kpi
METRIC_SWITCH = {
    "penetration": ("reach", "Switch to reach instead of penetration"),
    "reach": ("viewing_time", "Switch to viewing time instead of reach"),
    "viewing_time": ("reach", "Switch to reach instead of viewing time"),
    "spend": ("stacking", "Switch to stacking instead of spend"),
    "churn_intention": ("penetration", "Switch to penetration instead of churn"),
    "stacking": ("penetration", "Switch to penetration instead of stacking"),
    "account_sharing": ("penetration", "Switch to penetration instead of sharing"),
    "gross_access": ("penetration", "Switch to penetration instead of gross access"),
}

SERVICE_FILTER_KEYWORDS = {
    "streaming services": "is_streaming_service",
    "svod services": "is_streaming_service",
    "paid streaming": "is_streaming_service",
    "subscription services": "is_streaming_service",
    "social media": "is_social_video",
    "social video": "is_social_video",
    "social platforms": "is_social_video",
    "public broadcasters": "is_public_service",
    "public service": "is_public_service",
    "public services": "is_public_service",
    "avod services": "is_avod",
    "ad-supported": "is_avod",
    "ad supported": "is_avod",
    "free streaming": "is_avod",
    "fast channels": "is_fast",
    "fast services": "is_fast",
}
_SF_PATTERNS = sorted(SERVICE_FILTER_KEYWORDS.keys(), key=len, reverse=True)

GENRE_KEYWORDS = [
    "drama", "sports", "film", "kids", "comedy", "documentary", "documentaries",
    "news", "reality", "crime", "sci-fi", "horror", "action", "animation",
]


def _match_lower(text, patterns, mapping):
    low = text.lower()
    for pat in patterns:
        if pat in low:
            return mapping[pat]
    return None


def _match_word_boundary(text, patterns, mapping):
    low = text.lower()
    for pat in patterns:
        if re.search(r'\b' + re.escape(pat) + r'\b', low):
            return mapping[pat]
    return None


def extract_intent(prompt):
    """Extract explicit signals from user prompt. Returns PartialIntent dict."""
    low = prompt.lower()
    partial = {}

    # kpi_type
    kpi = _match_lower(low, _KPI_PATTERNS, KPI_KEYWORDS)
    if kpi:
        partial["kpi_type"] = kpi

    # kpi_dimension
    dim = _match_lower(low, _DIM_PATTERNS, DIMENSION_KEYWORDS)
    if dim:
        partial["kpi_dimension"] = dim

    # video type comparison: aggregated KPIs (svod, ssvod, bsvod, hvod, tve, pay_tv)
    for vt_phrase in VIDEO_TYPE_KEYWORDS:
        if vt_phrase in low:
            partial["kpi_dimension"] = "video_type_comparison"
            partial["service_level"] = False
            break

    # genre detection
    for g in GENRE_KEYWORDS:
        if re.search(r'\b' + re.escape(g) + r'\b', low):
            partial["kpi_dimension"] = "genre"
            partial["kpi_detail"] = g
            break

    # category
    cat = _match_lower(low, _CAT_PATTERNS, CATEGORY_KEYWORDS)
    if cat:
        partial["category"] = cat

    # countries
    countries = []
    if "nordic" in low or "nordics" in low:
        countries = list(ALL_COUNTRIES)
    else:
        for word in re.findall(r'\b\w+\b', low):
            if word in COUNTRY_MAP:
                c = COUNTRY_MAP[word]
                if c not in countries:
                    countries.append(c)
    if countries:
        partial["countries"] = countries

    # services
    services = []
    for pat in _SERVICE_PATTERNS:
        if re.search(r'\b' + re.escape(pat) + r'\b', low):
            sid = SERVICE_MAP[pat]
            if sid not in services:
                services.append(sid)
    if services:
        partial["service_ids"] = services

    # service filter (streaming services, social media, etc.)
    sf = _match_lower(low, _SF_PATTERNS, SERVICE_FILTER_KEYWORDS)
    if sf:
        partial["service_filter"] = sf

    # top N
    top_match = re.search(r'\btop\s+(\d+|five|ten|three|fifteen)\b', low)
    if top_match:
        num_str = top_match.group(1)
        num_map = {"five": 5, "ten": 10, "three": 3, "fifteen": 15}
        partial["top_n"] = num_map.get(num_str, int(num_str) if num_str.isdigit() else 5)
    elif "top services" in low or "top streaming" in low:
        partial["top_n"] = 5

    # time
    if any(w in low for w in ["trend", "over time", "historical", "over the last", "development"]):
        partial["trend_mode"] = True
    year_match = re.search(r'\b(20[12]\d)\b', low)
    if year_match:
        partial["year"] = year_match.group(1)
    q_match = re.search(r'\bq([1-4])\b', low)
    if q_match:
        partial["quarter"] = int(q_match.group(1))
    if "fall" in low or "autumn" in low:
        partial["quarter"] = 3
    if "spring" in low:
        partial["quarter"] = 1

    # age group
    age_match = re.search(r'\b(\d{2})-(\d{2})\b', low)
    if age_match:
        partial["age_group"] = age_match.group(0)

    return partial


def is_data_query(partial):
    """Returns True if the prompt has any data-related signals."""
    if partial.get("kpi_type") or partial.get("kpi_dimension") or partial.get("service_ids"):
        return True
    if partial.get("countries") or partial.get("top_n") or partial.get("category"):
        return True
    if partial.get("service_filter") or partial.get("trend_mode") or partial.get("year"):
        return True
    return False


def resolve_defaults(partial):
    """Fill every missing slot with sensible defaults. Returns ResolvedIntent dict."""
    r = dict(partial)
    defaults = []

    # Step 1: kpi_type
    if "kpi_type" not in r:
        # infer from dimension if present
        active_map = _dynamic_dim_to_kpi if _dynamic_dim_to_kpi else DIMENSION_TO_KPI
        if r.get("kpi_dimension") and r["kpi_dimension"] in active_map:
            r["kpi_type"] = active_map[r["kpi_dimension"]]
            defaults.append(f"kpi_type: inferred {r['kpi_type']} from dimension")
        else:
            r["kpi_type"] = "penetration"
            defaults.append("kpi_type: assumed penetration")

    # service_level: true when services named, top_n requested, or service_filter set
    if r.get("service_ids") or r.get("top_n") or r.get("service_filter"):
        r["service_level"] = True
    else:
        r["service_level"] = False

    # Step 2: kpi_dimension
    if r.get("kpi_dimension") == "video_type_comparison":
        r["kpi_dimension"] = None
        r["service_level"] = False
        r["video_type_comparison"] = True
    elif "kpi_dimension" not in r:
        default_dim = KPI_DIMENSION_DEFAULTS.get(r["kpi_type"])
        if default_dim:
            r["kpi_dimension"] = default_dim
            defaults.append(f"dimension: {default_dim}")
        else:
            r["kpi_dimension"] = None

    # Step 3: category
    if "category" not in r:
        r["category"] = "online_video"
        defaults.append("category: online_video")

    # Step 4: countries + quarter_filter
    if "countries" not in r:
        r["countries"] = list(ALL_COUNTRIES)
        defaults.append("geography: Nordic average (population-weighted)")
    if len(r["countries"]) == 1 and r["countries"][0] == "sweden":
        r["quarter_filter"] = [1, 2, 3, 4]
    else:
        r["quarter_filter"] = [1, 3]
        if len(r["countries"]) > 1:
            if "geography" not in "".join(defaults):
                defaults.append("quarter filter: Q1+Q3 only (multi-country)")

    # Step 5: population_weight
    if r["kpi_type"] in INDIVIDUAL_KPIS:
        r["population_weight"] = "individuals"
    else:
        r["population_weight"] = "households"

    # Step 6: period_mode
    if r.get("trend_mode"):
        r["period_mode"] = "trend"
    elif r.get("year") or r.get("quarter"):
        r["period_mode"] = "specific"
    else:
        r["period_mode"] = "latest_yoy"
        defaults.append("period: latest vs year-ago")

    # Step 7: top_n cap
    if r.get("top_n") and r["top_n"] > 15:
        r["top_n"] = 15

    # Step 8: optional filters
    if "age_group" not in r:
        r["age_group"] = None  # total population (15-74 is default in view)
    if "population_segment" not in r:
        # viewing_time service-level: default to viewers
        if r["kpi_type"] == "viewing_time" and r["service_level"]:
            r["population_segment"] = "viewers"
        else:
            r["population_segment"] = None

    r["applied_defaults"] = defaults
    return r


def build_preamble(resolved):
    """Build a one-line preamble describing what's being shown."""
    kpi = KPI_DISPLAY.get(resolved["kpi_type"], resolved["kpi_type"])
    dim = resolved.get("kpi_dimension")
    dim_str = DIMENSION_DISPLAY.get(dim, dim) if dim else ""

    # geography
    countries = resolved.get("countries", ALL_COUNTRIES)
    if len(countries) == 4:
        geo = "Nordic average"
    elif len(countries) == 1:
        geo = countries[0].title()
    else:
        geo = ", ".join(c.title() for c in countries)

    # services
    svc = ""
    if resolved.get("top_n"):
        svc = f"top {resolved['top_n']} services"
    elif resolved.get("service_ids"):
        svc = ", ".join(resolved["service_ids"])

    # period
    period = resolved.get("period_mode", "latest_yoy")
    if period == "trend":
        period_str = "trend over last 3 years"
    elif period == "specific":
        parts = []
        if resolved.get("quarter"):
            parts.append(f"Q{resolved['quarter']}")
        if resolved.get("year"):
            parts.append(resolved["year"])
        period_str = " ".join(parts)
    else:
        period_str = "latest vs year-ago"

    # assemble
    parts = []
    if dim_str:
        parts.append(f"{dim_str} {kpi}")
    else:
        parts.append(kpi)
    if svc:
        parts[0] += f" for {svc}"
    parts.append(geo)
    parts.append(period_str)

    line = "Showing " + " — ".join(parts) + "."

    # defaults note
    applied = resolved.get("applied_defaults", [])
    if applied:
        line += " *Assumed: " + ", ".join(applied) + ".*"

    return line


def build_suggestions(resolved):
    """Build 2-3 follow-on suggestion strings."""
    suggestions = []
    countries = resolved.get("countries", ALL_COUNTRIES)
    period = resolved.get("period_mode", "latest_yoy")
    kpi = resolved["kpi_type"]

    # 1. geographic drill
    if len(countries) == 4:
        suggestions.append("Break this down by country")
    elif len(countries) == 1:
        suggestions.append("Show Nordic average instead")
    else:
        suggestions.append("Show all Nordic countries")

    # 2. time drill
    if period == "latest_yoy":
        suggestions.append("Show the trend over the last 3 years")
    elif period == "trend":
        suggestions.append("Show latest period only")
    else:
        suggestions.append("Show the trend over the last 3 years")

    # 3. metric switch
    if kpi in METRIC_SWITCH:
        _, label = METRIC_SWITCH[kpi]
        suggestions.append(label)

    return suggestions[:3]


def build_intent_prompt_block(resolved):
    """Build a markdown block to inject into the LLM system prompt."""
    lines = [
        "## Resolved Query Intent (use these values for SQL generation)",
        f"- kpi_type: `{resolved['kpi_type']}`",
    ]
    if resolved.get("service_level"):
        lines.append("- Service level: yes (filter `canonical_name IS NOT NULL`)")
    else:
        lines.append("- Service level: no (market-level, `canonical_name IS NULL`)")

    if resolved.get("video_type_comparison"):
        lines.append("- **Video type comparison**: query multiple kpi_dimensions: `kpi_dimension IN ('svod','ssvod','bsvod','hvod','tve','pay_tv_channel')`. Use `canonical_name IS NULL` (market level). Do NOT use `n.service` — group by `kpi_dimension` and alias as `business_model` via `UPPER(kpi_dimension)`.")
    dim = resolved.get("kpi_dimension")
    if dim:
        lines.append(f"- kpi_dimension: `{dim}`")
    else:
        lines.append("- kpi_dimension: (any / not filtered)")

    lines.append(f"- category: `{resolved.get('category', 'online_video')}`")

    countries = resolved.get("countries", ALL_COUNTRIES)
    qf = resolved.get("quarter_filter", [1, 3])
    lines.append(f"- Countries: {', '.join(countries)} (quarter IN ({', '.join(str(q) for q in qf)}))")

    pw = resolved.get("population_weight", "households")
    lines.append(f"- Population weight: `{pw}` (use `population_{'1574' if pw == 'individuals' else 'household'}` column)")

    pm = resolved.get("period_mode", "latest_yoy")
    if pm == "trend":
        lines.append("- Period: trend — last 6 Q1/Q3 periods")
    elif pm == "specific":
        spec = []
        if resolved.get("year"):
            spec.append(f"year={resolved['year']}")
        if resolved.get("quarter"):
            spec.append(f"quarter={resolved['quarter']}")
        lines.append(f"- Period: specific — {', '.join(spec)}")
    else:
        lines.append("- Period: latest shared period vs year-ago (per-country MAX, not global)")

    if resolved.get("service_ids"):
        lines.append(f"- Services: {', '.join(resolved['service_ids'])}")
    if resolved.get("top_n"):
        lines.append(f"- Top N: {resolved['top_n']} (rank by value in latest period)")
    if resolved.get("service_filter"):
        lines.append(f"- Service filter: `{resolved['service_filter']} = true` (column on macro.nordic, no join needed)")
    if resolved.get("age_group"):
        lines.append(f"- Age group: `{resolved['age_group']}`")
    if resolved.get("population_segment"):
        lines.append(f"- Population segment: `{resolved['population_segment']}`")
    if resolved.get("kpi_detail"):
        lines.append(f"- kpi_detail: `{resolved['kpi_detail']}`")

    lines.append("")
    lines.append("Generate SQL using exactly these parameters. Do not ask clarifying questions.")
    return "\n".join(lines)
