"""CAPTCHA OCR: ddddocr first (optional), then upright template slide."""
from __future__ import annotations

import os
import threading
from functools import lru_cache
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from .enhance import ocr_variants
from .preprocess import Blob, connected_blobs, crop_pad, find_font, ink_mask, to_gray

CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
HIT_IOU = 0.62
BLOB_HIT = 0.38
NORM = (14, 18)


@lru_cache(maxsize=1)
def _font(size: int = 32) -> ImageFont.ImageFont:
    path = find_font()
    if path:
        return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _as_bw(im: Image.Image) -> Image.Image:
    return im.convert("L").point(lambda p: 0 if p < 160 else 255)


def color_ink_mask(img: Image.Image) -> list[list[bool]]:
    """Ink = saturated color or dark stroke (keeps bright green DCP glyphs)."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    mask = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            chroma = max(r, g, b) - min(r, g, b)
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            mask[y][x] = chroma >= 28 or luma < 125
    return mask


def mask_to_image(mask: list[list[bool]]) -> Image.Image:
    h = len(mask)
    w = len(mask[0]) if h else 0
    im = Image.new("L", (w, h), 255)
    p = im.load()
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if row[x]:
                p[x, y] = 0
    return im


def _render_glyph(ch: str) -> Image.Image:
    font = _font(32)
    probe = Image.new("L", (8, 8), 255)
    x0, y0, x1, y1 = ImageDraw.Draw(probe).textbbox((0, 0), ch, font=font)
    canvas = Image.new("L", (max(8, x1 - x0 + 4), max(8, y1 - y0 + 4)), 255)
    ImageDraw.Draw(canvas).text((2 - x0, 2 - y0), ch, fill=0, font=font)
    bw = _as_bw(canvas)
    box = bw.getbbox()
    return bw.crop(box) if box else bw


@lru_cache(maxsize=1)
def _glyphs() -> dict[str, Image.Image]:
    return {ch: _render_glyph(ch) for ch in CHARSET}


@lru_cache(maxsize=1)
def _norm_glyphs() -> dict[str, Image.Image]:
    out: dict[str, Image.Image] = {}
    for ch, g in _glyphs().items():
        out[ch] = _normalize(g)
    return out


def _normalize(bw: Image.Image) -> Image.Image:
    bw = bw.convert("L")
    box = bw.point(lambda p: 0 if p < 160 else 255).getbbox()
    if box:
        bw = bw.crop(box)
    tw, th = NORM
    scale = min(tw / max(bw.size[0], 1), th / max(bw.size[1], 1))
    nw = max(1, int(round(bw.size[0] * scale)))
    nh = max(1, int(round(bw.size[1] * scale)))
    bw = bw.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new("L", NORM, 255)
    canvas.paste(bw, ((tw - nw) // 2, (th - nh) // 2))
    return canvas.point(lambda p: 0 if p < 160 else 255)


def _hamming(a: Image.Image, b: Image.Image) -> float:
    pa, pb = a.tobytes(), b.tobytes()
    n = len(pa) or 1
    same = sum(1 for x, y in zip(pa, pb) if (x < 160) == (y < 160))
    return same / n


def _iou_at(hay: Image.Image, needle: Image.Image, x: int, y: int) -> float:
    tw, th = needle.size
    crop = hay.crop((x, y, x + tw, y + th))
    if crop.size != needle.size:
        return 0.0
    a = crop.tobytes()
    b = needle.tobytes()
    inter = 0
    union = 0
    for pa, pb in zip(a, b):
        ia = pa < 160
        ib = pb < 160
        if ia and ib:
            inter += 1
        if ia or ib:
            union += 1
    if union < 8:
        return 0.0
    return inter / union


def _split_wide(blobs: list[Blob], mask: list[list[bool]]) -> list[Blob]:
    out: list[Blob] = []
    h = len(mask)
    for b in blobs:
        if b.w <= b.h * 1.45 or b.w < 16:
            out.append(b)
            continue
        cols = []
        for x in range(b.x0, b.x1 + 1):
            cols.append(sum(1 for y in range(b.y0, b.y1 + 1) if y < h and mask[y][x]))
        mid0 = b.w // 3
        mid1 = (2 * b.w) // 3
        if mid1 <= mid0:
            out.append(b)
            continue
        window = cols[mid0:mid1]
        split_rel = mid0 + min(range(len(window)), key=lambda i: window[i])
        split_x = b.x0 + split_rel
        left = [bb for bb in connected_blobs(
            [[mask[y][x] and x < split_x for x in range(len(mask[0]))] for y in range(h)],
            min_area=12,
        ) if bb.x0 >= b.x0 - 1 and bb.x1 <= split_x]
        right = [bb for bb in connected_blobs(
            [[mask[y][x] and x >= split_x for x in range(len(mask[0]))] for y in range(h)],
            min_area=12,
        ) if bb.x1 <= b.x1 + 1 and bb.x0 >= split_x - 1]
        parts = [p for p in left + right if p.area >= 12]
        if len(parts) >= 2:
            out.extend(sorted(parts, key=lambda p: p.x0))
        else:
            out.append(b)
    out.sort(key=lambda p: p.x0)
    return out


def match_rotated(glyph: Image.Image) -> tuple[str, float]:
    bw = glyph.convert("L").point(lambda p: 0 if p < 160 else 255)
    box = bw.getbbox()
    if not box:
        return "", 0.0
    bw = bw.crop(box)
    holes = count_holes(bw)
    templates = _norm_glyphs()
    best_ch = ""
    best = 0.0
    for ang in range(-40, 41, 5):
        rot = bw.rotate(ang, expand=True, fillcolor=255)
        n = _normalize(rot)
        for ch, tmpl in templates.items():
            th = _glyph_holes(ch)
            if th is not None and abs(th - holes) > 1:
                continue
            s = _hamming(n, tmpl)
            if s > best:
                best = s
                best_ch = ch
    return best_ch, best


@lru_cache(maxsize=128)
def _glyph_holes(ch: str) -> int | None:
    g = _glyphs().get(ch)
    if g is None:
        return None
    return count_holes(g)


def chroma_ratio(img: Image.Image) -> float:
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    n = 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(r, g, b) - min(r, g, b) >= 40:
                n += 1
    return n / max(1, w * h)


def count_holes(bw: Image.Image) -> int:
    W, H = bw.size
    p = bw.load()

    def is_bg(x: int, y: int) -> bool:
        return p[x, y] >= 160

    seen = [bytearray(W) for _ in range(H)]
    stack: list[tuple[int, int]] = []
    for x in range(W):
        for y in (0, H - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = 1
                stack.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = 1
                stack.append((x, y))
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and is_bg(nx, ny):
                seen[ny][nx] = 1
                stack.append((nx, ny))
    holes = 0
    for y in range(H):
        for x in range(W):
            if is_bg(x, y) and not seen[y][x]:
                holes += 1
                stack = [(x, y)]
                seen[y][x] = 1
                while stack:
                    cx, cy = stack.pop()
                    for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                        if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and is_bg(nx, ny):
                            seen[ny][nx] = 1
                            stack.append((nx, ny))
    return holes


def feature_score(img: Image.Image) -> float:
    gray = to_gray(img, denoise=False)
    mask, _ = ink_mask(gray)
    blobs = connected_blobs(mask, min_area=12)
    if 2 <= len(blobs) <= 8:
        return 0.55
    if len(blobs) == 1:
        return 0.35
    return 0.1


def _solve_blobs(img: Image.Image) -> dict | None:
    work = img.convert("RGB")
    if max(work.size) < 180:
        work = work.resize((work.size[0] * 3, work.size[1] * 3), Image.Resampling.BICUBIC)
        work = work.filter(ImageFilter.SHARPEN)
    mask = color_ink_mask(work)
    w = work.size[0]
    h = work.size[1]
    min_area = max(18, (w * h) // 400)
    blobs = connected_blobs(mask, min_area=min_area)
    blobs = [b for b in blobs if b.w < w * 0.9 and b.h < h * 0.95]
    blobs = _split_wide(blobs, mask)
    if len(blobs) < 3 or len(blobs) > 8:
        return None
    bw = mask_to_image(mask)
    chars: list[str] = []
    confs: list[float] = []
    for b in blobs:
        if b.h < 8 or b.w < 4:
            continue
        glyph = crop_pad(bw, b.as_box(), pad=1)
        ch, conf = match_rotated(glyph)
        if conf < BLOB_HIT or not ch:
            continue
        chars.append(ch)
        confs.append(conf)
    text = "".join(chars)
    if len(text) < 3:
        return None
    return {
        "solved": True,
        "kind": "image",
        "text": text,
        "confidence": round(sum(confs) / len(confs), 4),
    }


def _solve_slide(img: Image.Image) -> dict:
    hay = _as_bw(img)
    box = hay.getbbox()
    if not box:
        return {"solved": False, "kind": "image", "reason": "no ink for OCR"}
    hay = hay.crop(box)
    w, h = hay.size
    if w * h < 40:
        return {"solved": False, "kind": "image", "reason": "no ink for OCR"}

    glyphs = {ch: g for ch, g in _glyphs().items() if ch in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
    x = 0
    chars: list[str] = []
    confs: list[float] = []
    while x < w - 4:
        best_ch = ""
        best_s = 0.0
        best_w = 8
        for ch, glyph in glyphs.items():
            tw, th = glyph.size
            if tw > w - x or th > h:
                continue
            y_max = max(0, h - th)
            for y in range(0, y_max + 1, 1 if y_max <= 4 else 2):
                s = _iou_at(hay, glyph, x, y)
                if s > best_s:
                    best_s = s
                    best_ch = ch
                    best_w = tw
        if best_s >= HIT_IOU and best_ch:
            chars.append(best_ch)
            confs.append(best_s)
            x += max(6, int(best_w * 0.72))
        else:
            x += 2

    text = "".join(chars)
    if len(text) < 2:
        return {
            "solved": False,
            "kind": "image",
            "reason": "ocr low confidence",
            "text": text,
            "confidence": (sum(confs) / len(confs)) if confs else 0.0,
        }
    return {
        "solved": True,
        "kind": "image",
        "text": text,
        "confidence": round(sum(confs) / len(confs), 4),
    }


_dddd_lock = threading.Lock()
_dddd = None
_dddd_beta = None
_dddd_import_failed = False


def ocr_mode() -> str:
    from .context import get_profile_settings, get_retry_hints
    from .profile import cfg

    # Request-level retry/override hints win (S4/S5 request fields).
    hints = get_retry_hints()
    if hints.get("ocrMode"):
        raw = str(hints.get("ocrMode")).strip().lower()
    elif get_profile_settings():
        raw = str(cfg("ocr.mode", "auto") or "auto").strip().lower()
    else:
        raw = (os.environ.get("HERMES_CAPTCHA_OCR") or "auto").strip().lower()
    if raw in ("auto", "ddddocr", "template"):
        return raw
    return "auto"


def ddddocr_available() -> bool:
    if _dddd_import_failed:
        return False
    try:
        import ddddocr  # noqa: F401
    except Exception:
        return False
    return True


def min_conf() -> float:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("decision.minConf", cfg("ocr.minConf", 0.5)))))
        except (TypeError, ValueError):
            return 0.5
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_MIN_CONF") or "0.5").strip()
    try:
        val = float(raw)
    except ValueError:
        return 0.5
    return min(1.0, max(0.0, val))


def soft_conf() -> float:
    """Colorful-path fallback threshold (E1). Default 0.45 (A/B winner).

    Soft path only runs when soft_conf < min_conf.
    """
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("decision.softConf", cfg("ocr.softConf", 0.45)))))
        except (TypeError, ValueError):
            return 0.45
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_SOFT_CONF") or "0.45").strip()
    try:
        val = float(raw)
    except ValueError:
        return 0.45
    return min(1.0, max(0.0, val))


def beta_enabled() -> bool:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        v = cfg("ocr.beta", False)
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in ("1", "true", "yes", "on", "auto")
    return (os.environ.get("HERMES_CAPTCHA_OCR_BETA") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
        "auto",
    )


def agree_gate_enabled() -> bool:
    """E2: when beta is on, require std↔beta agreement unless explicitly disabled."""
    if not beta_enabled():
        return False
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        v = cfg("ocr.agree", True)
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() not in ("0", "false", "no", "off")
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_AGREE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def agree_relax() -> bool:
    """Escape hatch: skip disagreement abstain (E1-like). Default off."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        v = cfg("ocr.agreeRelax", False)
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in ("1", "true", "yes", "on")
    return (os.environ.get("HERMES_CAPTCHA_OCR_AGREE_RELAX") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _case_text(text: str) -> str:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        case = str(cfg("ocr.case", "lower") or "lower").strip().lower()
    else:
        case = (os.environ.get("HERMES_CAPTCHA_OCR_CASE") or "lower").strip().lower()
    if case == "lower":
        return text.lower()
    return text


def majority_reading_text(readings: list[tuple[str, str]]) -> str | None:
    """Majority whole-string (casefold) among normalized readings."""
    if not readings:
        return None
    groups: dict[str, list[str]] = {}
    for _, text in readings:
        groups.setdefault(text.casefold(), []).append(text)
    fold = max(groups, key=lambda k: (len(groups[k]), len(k), k))
    return _case_text(groups[fold][0])


def agree_min() -> float:
    """Minimum agreement to ACCEPT (default 1.0 = dual-engine support of winner)."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("ocr.agreeMin", 1.0))))
        except (TypeError, ValueError):
            return 1.0
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_AGREE_MIN") or "").strip()
    if not raw:
        return 1.0
    try:
        val = float(raw)
    except ValueError:
        return 1.0
    return min(1.0, max(0.0, val))


def compute_agreement(
    std_readings: list[tuple[str, str]],
    beta_readings: list[tuple[str, str]],
    winner: str | None = None,
) -> tuple[float, str | None, str | None]:
    """Agreement for Selective OCR.

    Primary (E2): if ``winner`` is set, agreement=1 when both std and beta
    produced that spelling at least once; else 0 (blocks one-sided singleton).

    Fallback (no winner): compare std/beta majorities — exact match 1.0,
    same-length char ratio otherwise.
    """
    std_t = majority_reading_text(std_readings)
    beta_t = majority_reading_text(beta_readings)
    if winner:
        fold = winner.casefold()
        std_hit = any(t.casefold() == fold for _, t in std_readings)
        beta_hit = any(t.casefold() == fold for _, t in beta_readings)
        if std_hit and beta_hit:
            return 1.0, std_t, beta_t
        return 0.0, std_t, beta_t
    if not std_t or not beta_t:
        return 0.0, std_t, beta_t
    a, b = std_t.casefold(), beta_t.casefold()
    if a == b:
        return 1.0, std_t, beta_t
    if len(a) != len(b) or not a:
        return 0.0, std_t, beta_t
    matches = sum(1 for x, y in zip(a, b) if x == y)
    return matches / len(a), std_t, beta_t


def gate_on_agreement(
    hit: dict,
    std_readings: list[tuple[str, str]],
    beta_readings: list[tuple[str, str]],
) -> dict:
    """E2: when both engines have readings, winner needs dual support.

    If beta (or std) produced zero valid readings, degrade to E1 accept of ``hit``
    (cannot form agreement; avoids abstaining on beta total failure).

    Scores stay separate: weightShare / evidenceScore / agreementScore / decisionScore.
    ``confidence`` mirrors decisionScore only (uncalibrated, Worker compat).
    """
    from .decision import apply_decision

    evidence = float(
        hit.get("evidenceScore")
        if hit.get("evidenceScore") is not None
        else hit.get("confidence")
        or 0.0
    )
    weight_share = float(
        hit.get("weightShare") if hit.get("weightShare") is not None else evidence
    )
    winner = str(hit.get("text") or "")
    floor = min(min_conf(), soft_conf())

    # No second opinion available → keep fused vote (E1).
    if not std_readings or not beta_readings:
        out = dict(hit)
        out["agreement"] = None
        out["agreementScore"] = None
        out["ocrConf"] = round(weight_share, 4)
        out["stdText"] = majority_reading_text(std_readings) or ""
        out["betaText"] = majority_reading_text(beta_readings) or ""
        return apply_decision(
            out,
            decision="accept" if hit.get("solved") else "abstain",
            reason="" if hit.get("solved") else str(hit.get("reason") or "ocr low evidence"),
            decision_score=float(hit.get("decisionScore") or hit.get("evidenceScore") or evidence),
        )

    agreement, std_t, beta_t = compute_agreement(
        std_readings, beta_readings, winner=winner or None
    )
    # Decision blend is an uncalibrated gate score — not P(correct).
    decision_score = 0.5 * evidence + 0.5 * agreement
    need = agree_min()

    base_meta = {
        "kind": "image",
        "engine": hit.get("engine") or "ddddocr",
        "preprocess": hit.get("preprocess"),
        "votes": hit.get("votes"),
        "weightShare": hit.get("weightShare"),
        "evidenceScore": round(evidence, 4),
        "ocrConf": round(weight_share, 4),
        "agreement": round(agreement, 4),
        "agreementScore": round(agreement, 4),
        "stdText": std_t or "",
        "betaText": beta_t or "",
    }

    if agree_relax():
        out = dict(hit)
        out.update(base_meta)
        return apply_decision(
            out,
            decision="accept" if hit.get("solved") else "abstain",
            reason="" if hit.get("solved") else str(hit.get("reason") or "ocr low evidence"),
            decision_score=float(hit.get("decisionScore") or hit.get("confidence") or decision_score),
        )

    if agreement + 1e-9 >= need and evidence + 1e-9 >= floor and winner:
        out = dict(hit)
        out.update(base_meta)
        out["text"] = _case_text(winner)
        return apply_decision(out, decision="accept", reason="", decision_score=decision_score)

    reason = "ocr model disagreement" if agreement + 1e-9 < need else "ocr low evidence"
    out = dict(hit)
    out.update(base_meta)
    out["text"] = ""
    return apply_decision(out, decision="abstain", reason=reason, decision_score=decision_score)


def preferred_len() -> int | None:
    """Exact expected captcha length (e.g. 6 for captcha-demo). None = keep 4–6."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        raw = cfg("ocr.len", None)
        if raw is None or raw == "":
            return None
        try:
            n = int(raw)
        except (TypeError, ValueError):
            return None
        return n if 3 <= n <= 8 else None
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_LEN") or "").strip()
    if not raw:
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    return n if 3 <= n <= 8 else None


def allowed_charset() -> str | None:
    """Optional A-Za-z0-9 subset. Empty = all ASCII alnum."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        raw = cfg("ocr.charset", None)
        if raw is None:
            return None
        raw = str(raw).strip()
        if not raw:
            return None
        chars = "".join(ch for ch in raw if ("0" <= ch <= "9") or ("A" <= ch <= "Z") or ("a" <= ch <= "z"))
        return chars or None
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_CHARSET") or "").strip()
    if not raw:
        return None
    chars = "".join(ch for ch in raw if ("0" <= ch <= "9") or ("A" <= ch <= "Z") or ("a" <= ch <= "z"))
    return chars or None


def normalize_captcha_text(raw: str) -> str:
    """Keep ASCII A-Za-z0-9 only (not Unicode isalnum).

    Non-ASCII letters (e.g. CJK OCR garbage) are stripped, not kept.
    Length: exact HERMES_CAPTCHA_OCR_LEN if set, else 4–6.
    Optional HERMES_CAPTCHA_OCR_CHARSET filters glyphs.
    """
    raw_s = (raw or "").strip()
    ascii_alnum = "".join(
        ch for ch in raw_s if ("0" <= ch <= "9") or ("A" <= ch <= "Z") or ("a" <= ch <= "z")
    )
    charset = allowed_charset()
    if charset:
        allowed = set(charset)
        # Exact membership only — do not map l↔L via casefold (demo allows L, not l).
        ascii_alnum = "".join(ch for ch in ascii_alnum if ch in allowed)
    want = preferred_len()
    if want is not None:
        return ascii_alnum if len(ascii_alnum) == want else ""
    if 4 <= len(ascii_alnum) <= 6:
        return ascii_alnum
    return ""


def fuse_position_vote(
    readings: list[tuple[str, str]],
    want_len: int,
    threshold: float | None = None,
) -> dict | None:
    """Per-character majority vote across length-matched readings."""
    if threshold is None:
        threshold = min_conf()
    matched = [(n, t) for n, t in readings if len(t) == want_len]
    if len(matched) < 2:
        return None
    chars: list[str] = []
    pos_votes = 0
    for i in range(want_len):
        counts: dict[str, int] = {}
        for _, t in matched:
            ch = t[i]
            if (os.environ.get("HERMES_CAPTCHA_OCR_CASE") or "lower").strip().lower() == "lower":
                ch = ch.lower()
            counts[ch] = counts.get(ch, 0) + 1
        winner = max(counts, key=lambda c: (counts[c], c))
        chars.append(winner)
        pos_votes += counts[winner]
    text = normalize_captcha_text("".join(chars))
    if not text:
        return None
    confidence = pos_votes / (len(matched) * want_len)
    if confidence < threshold:
        return None
    return {
        "solved": True,
        "kind": "image",
        "text": text,
        "confidence": round(float(confidence), 4),
        "engine": "ddddocr",
        "preprocess": "position_vote",
        "votes": len(matched),
    }


def morph_weight() -> float:
    """Weight for morph_* paths in vote fusion. Default 0.8 (E3)."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("ocr.morphWeight", 0.8))))
        except (TypeError, ValueError):
            return 0.8
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_MORPH_WEIGHT") or "0.8").strip()
    try:
        val = float(raw)
    except ValueError:
        return 0.8
    return min(1.0, max(0.0, val))


def variant_weight(name: str) -> float:
    """Preprocess variant weight; morph_* paths use morph_weight()."""
    base = (name or "").split("+", 1)[0].strip().lower()
    if base.startswith("morph"):
        return morph_weight()
    return 1.0


def fuse_ocr_votes(
    readings: list[tuple[str, str]],
    attempts: int,
    threshold: float | None = None,
    *,
    img: Image.Image | None = None,
) -> dict | None:
    """readings: (preprocess_name, normalized_text). Empty texts must be omitted.

    Weighted whole-string vote (E3): morph_* variants use morph_weight().
    Optional position vote only as fallback when HERMES_CAPTCHA_OCR_LEN is set
    and string vote misses (POS_VOTE opt-in).

    When ``img`` is provided and independentSource is on, secondary OCR runs
    *before* Decision so E1-D agree bonus can calibrate evidenceScore
    (same threshold; no conflict/char penalties).
    """
    if threshold is None:
        threshold = min_conf()
    want = preferred_len()
    # Drop zero-weight readings (morph fully disabled).
    weighed = [(n, t, variant_weight(n)) for n, t in readings if variant_weight(n) > 1e-12]
    n_valid = len(weighed)
    if n_valid == 0:
        try:
            from .abstain_attr import build_abstain_reason_detail, store_abstain_probe

            detail = build_abstain_reason_detail(
                {},
                {"reason": "ocr low confidence", "decision": "abstain"},
                threshold=float(threshold) if threshold is not None else None,
                raw_readings=0,
            )
            store_abstain_probe(
                {
                    "abstainReasonDetail": detail,
                    "abstainBucket": detail.get("bucket"),
                    "decision": "abstain",
                    "solved": False,
                    "decisionReason": "ocr low confidence",
                }
            )
        except Exception:
            pass
        return None
    total_w = sum(w for _, _, w in weighed)
    groups: dict[str, list[tuple[str, str, float]]] = {}
    for name, text, w in weighed:
        groups.setdefault(text.casefold(), []).append((name, text, w))

    def group_key(k: str) -> tuple:
        bucket = groups[k]
        sample = bucket[0][1]
        score = sum(w for _, _, w in bucket)
        len_bonus = 1 if (want is not None and len(sample) == want) else 0
        return (len_bonus, score, len(bucket), len(sample), k)

    fold = max(groups, key=group_key)
    bucket = groups[fold]
    votes = len(bucket)
    score = sum(w for _, _, w in bucket)
    spell_scores: dict[str, float] = {}
    first_variant: dict[str, str] = {}
    for name, text, w in bucket:
        spell_scores[text] = spell_scores.get(text, 0.0) + w
        first_variant.setdefault(text, name)
    winner_spell = max(spell_scores, key=lambda t: (spell_scores[t], len(t), t))
    winner = winner_spell
    if (os.environ.get("HERMES_CAPTCHA_OCR_CASE") or "lower").strip().lower() == "lower":
        winner = winner_spell.lower()
    n_try = max(int(attempts), 1)
    weight_share = score / max(total_w, 1e-9)
    from .candidate_margin import candidate_margin_enabled, vote_margin_fields
    from .decision import decide_ocr_candidate
    from .evidence import score_decorrelated_evidence
    from .evidence_adjust import apply_independent_agree_bonus

    # F2-A/B: weightShare stays raw; evidenceScore uses independent groups (not variant count).
    # Singleton + LEN no longer boosts to 1.0 (S1).
    ev = score_decorrelated_evidence(
        winner_fold=fold,
        weighed=weighed,
        votes=votes,
        n_valid=n_valid,
        n_try=n_try,
        weight_score=score,
        weight_share=weight_share,
        singleton=(n_valid == 1),
        engine="ddddocr",
    )
    candidate = {
        "kind": "image",
        "text": winner,
        "engine": "ddddocr",
        "preprocess": first_variant[winner_spell],
        "votes": votes,
        **ev,
    }
    # E1-B: vote-share top1/top2 margin (observation only).
    if candidate_margin_enabled():
        margin = vote_margin_fields(weighed, prefer_len=want)
        candidate.update(margin)

    # E1-C/E1-D: independent source before Decision (when image available).
    if img is not None:
        try:
            from .independent_source import build_independent_evidence, independent_source_enabled

            if independent_source_enabled():
                try:
                    conf_f = float(candidate.get("evidenceScore"))
                except (TypeError, ValueError):
                    conf_f = None
                indep = build_independent_evidence(
                    img,
                    primary_text=winner,
                    primary_confidence=conf_f,
                    primary_source="ddddocr",
                )
                candidate.update(indep)
        except Exception:
            candidate["secondaryStatus"] = "error"

    # E1-D: optional independentAgree soft bonus (no threshold / penalty changes).
    candidate = apply_independent_agree_bonus(candidate)

    decided = decide_ocr_candidate(candidate, threshold=float(threshold))
    if decided.get("solved"):
        try:
            from .abstain_attr import clear_abstain_probe

            clear_abstain_probe()
        except Exception:
            pass
        return decided

    # A0: stash attribution before returning None (soft path / empty abstain still run).
    try:
        from .abstain_attr import build_abstain_reason_detail, store_abstain_probe

        detail = build_abstain_reason_detail(
            candidate,
            decided,
            threshold=float(threshold),
            raw_readings=n_valid,
        )
        probe = {
            **{k: candidate.get(k) for k in (
                "evidenceScore",
                "evidenceScoreRaw",
                "evidenceScoreAdjusted",
                "agreementScore",
                "weightShare",
                "votes",
                "nValid",
                "independentSources",
                "correlatedVotes",
                "singleton",
                "preprocess",
                "independentAgree",
                "independentConflict",
                "secondaryAvailable",
                "secondaryText",
                "secondarySource",
                "comparisonStatus",
                "comparisonReason",
                "secondaryComparison",
                "sourceAgreement",
                "charMinConfidence",
                "charMinMargin",
                "charSummary",
            ) if candidate.get(k) is not None},
            "decisionReason": decided.get("decisionReason") or decided.get("reason"),
            "abstainCandidateText": str(candidate.get("text") or "") or None,
            "abstainReasonDetail": detail,
            "abstainBucket": detail.get("bucket"),
            "decision": "abstain",
            "solved": False,
        }
        store_abstain_probe(probe)
    except Exception:
        pass

    if want is not None and (os.environ.get("HERMES_CAPTCHA_OCR_POS_VOTE") or "").strip() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return fuse_position_vote([(n, t) for n, t, _ in weighed], want, threshold=threshold)
    return None


def _png_bytes(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _ddddocr_engine(*, beta: bool = False):
    """Return lazy ddddocr engine or None if unavailable."""
    global _dddd, _dddd_beta, _dddd_import_failed
    if _dddd_import_failed:
        return None
    try:
        import ddddocr
    except Exception:
        _dddd_import_failed = True
        return None
    with _dddd_lock:
        if beta:
            if _dddd_beta is None:
                try:
                    _dddd_beta = ddddocr.DdddOcr(show_ad=False, beta=True)
                except TypeError:
                    _dddd_beta = ddddocr.DdddOcr(show_ad=False)
            return _dddd_beta
        if _dddd is None:
            _dddd = ddddocr.DdddOcr(show_ad=False)
        return _dddd


def _ddddocr_text(img: Image.Image, *, beta: bool = False) -> str:
    global _dddd_import_failed
    engine = _ddddocr_engine(beta=beta)
    if engine is None:
        return ""
    try:
        with _dddd_lock:
            return str(engine.classification(_png_bytes(img), png_fix=True) or "").strip()
    except Exception:
        return ""


def _ddddocr_probability(img: Image.Image, *, beta: bool = False) -> dict | None:
    """E1-A: one probability-mode call for character evidence (observation only)."""
    engine = _ddddocr_engine(beta=beta)
    if engine is None:
        return None
    try:
        with _dddd_lock:
            out = engine.classification(_png_bytes(img), png_fix=True, probability=True)
        return out if isinstance(out, dict) else None
    except Exception:
        return None


def _attach_character_evidence(
    hit: dict,
    img: Image.Image,
    *,
    colorful: bool,
    variants: list[tuple[str, Image.Image]] | None = None,
) -> dict:
    """Add characterEvidence fields without changing decision / decisionScore."""
    from .char_evidence import char_evidence_enabled, parse_dddd_probability

    if not char_evidence_enabled():
        return hit
    text = str(hit.get("text") or "").strip()
    if not text:
        return hit
    # Preserve decision contract.
    decision_before = hit.get("decision")
    solved_before = hit.get("solved")
    score_before = hit.get("decisionScore")
    conf_before = hit.get("confidence")

    pp = str(hit.get("preprocess") or "raw")
    beta = "+beta" in pp
    base_pp = pp.split("+", 1)[0]
    variant_img = img
    source = variants or ocr_variants(img, colorful=colorful)
    for name, vim in source:
        if name == base_pp:
            variant_img = vim
            break
    payload = _ddddocr_probability(variant_img, beta=beta)
    if not payload:
        hit["charEvidenceStatus"] = "unavailable"
        return hit
    parsed = parse_dddd_probability(payload, text_hint=text)
    hit["characterEvidence"] = parsed["characterEvidence"]
    hit["charSummary"] = parsed["charSummary"]
    # Convenience mirrors (observation / bench); not decision inputs.
    summary = parsed["charSummary"]
    hit["charMinConfidence"] = summary.get("charMinConfidence")
    hit["charMeanConfidence"] = summary.get("charMeanConfidence")
    hit["charAmbiguousCount"] = summary.get("ambiguousCount")
    hit["charEvidenceStatus"] = "ok"

    # E1-B complement: char-swap runner-up from weakest glyph (observation only).
    try:
        from .candidate_margin import candidate_margin_enabled, char_swap_runner_up

        if candidate_margin_enabled():
            swap = char_swap_runner_up(text, hit.get("characterEvidence"))
            hit.update(swap)
    except Exception:
        pass

    # E1-C: secondary cross-family OCR (skip if already attached pre-Decision for E1-D).
    try:
        from .independent_source import build_independent_evidence, independent_source_enabled

        if independent_source_enabled() and hit.get("independentEvidence") is None:
            conf = hit.get("decisionScore")
            if conf is None:
                conf = hit.get("confidence")
            try:
                conf_f = float(conf) if conf is not None else None
            except (TypeError, ValueError):
                conf_f = None
            indep = build_independent_evidence(
                img,
                primary_text=text,
                primary_confidence=conf_f,
                primary_source=str(hit.get("engine") or "ddddocr").split("+")[0] or "ddddocr",
            )
            hit.update(indep)
    except Exception:
        hit["secondaryStatus"] = "error"

    # Hard restore — E1 observation must not alter Decision.
    if decision_before is not None:
        hit["decision"] = decision_before
    if solved_before is not None:
        hit["solved"] = solved_before
    if score_before is not None:
        hit["decisionScore"] = score_before
    if conf_before is not None:
        hit["confidence"] = conf_before
    return hit


def _try_ddddocr(img: Image.Image, colorful: bool = False) -> dict | None:
    """Multi-variant ddddocr + vote (+ E2 agreement gate when beta on)."""
    if _dddd_import_failed:
        return None
    variants = ocr_variants(img, colorful=colorful)
    if not variants:
        return None
    std_readings: list[tuple[str, str]] = []
    beta_readings: list[tuple[str, str]] = []
    use_beta = beta_enabled()
    for name, variant in variants:
        raw = _ddddocr_text(variant)
        if _dddd_import_failed:
            return None
        norm = normalize_captcha_text(raw)
        if norm:
            std_readings.append((name, norm))
        if use_beta:
            raw_b = _ddddocr_text(variant, beta=True)
            norm_b = normalize_captcha_text(raw_b)
            if norm_b:
                beta_readings.append((name + "+beta", norm_b))
    readings = std_readings + beta_readings
    hit = fuse_ocr_votes(readings, attempts=max(len(variants), 1), img=img)
    if not hit and colorful and readings:
        soft = soft_conf()
        if soft < min_conf() - 1e-9:
            hit = fuse_ocr_votes(readings, attempts=max(len(variants), 1), threshold=soft, img=img)
    if not hit:
        return None
    fused = dict(hit)
    if agree_gate_enabled():
        hit = gate_on_agreement(hit, std_readings, beta_readings)
    else:
        hit = dict(hit)
        hit["decision"] = "accept"
        hit["agreement"] = None
    # E1-A: attach char evidence for ACCEPT (and any result still carrying text).
    # Does not change decisionScore / accept|abstain.
    if hit.get("solved") or str(hit.get("text") or "").strip():
        if not str(hit.get("text") or "").strip() and fused.get("text"):
            # Preserve hint only inside attach via copy — do not re-ACCEPT.
            probe = dict(hit)
            probe["text"] = fused["text"]
            probe["preprocess"] = fused.get("preprocess") or hit.get("preprocess")
            probe = _attach_character_evidence(probe, img, colorful=colorful, variants=variants)
            for k in (
                "characterEvidence",
                "charSummary",
                "charMinConfidence",
                "charMeanConfidence",
                "charAmbiguousCount",
                "charEvidenceStatus",
            ):
                if k in probe:
                    hit[k] = probe[k]
        else:
            hit = _attach_character_evidence(hit, img, colorful=colorful, variants=variants)
    return hit


def _solve_template(img: Image.Image) -> dict:
    # Colored / rotated glyphs: template match fills wrong text. Refuse.
    if chroma_ratio(img) >= 0.05:
        return {
            "solved": False,
            "kind": "image",
            "reason": "color/rotated captcha; template OCR only reads upright dark text",
            "confidence": 0.0,
            "engine": "template",
            "decision": "abstain",
        }
    out = _solve_slide(img)
    out["engine"] = "template"
    return out


def solve_image(img: Image.Image) -> dict:
    mode = ocr_mode()
    colorful = chroma_ratio(img) >= 0.05
    if mode == "template":
        return _solve_template(img)

    try:
        from .abstain_attr import clear_abstain_probe, merge_probe_into_result

        clear_abstain_probe()
    except Exception:
        merge_probe_into_result = None  # type: ignore[assignment]

    hit = _try_ddddocr(img, colorful=colorful)
    dddd_miss = hit is None
    if hit is None:
        hit = {
            "solved": False,
            "kind": "image",
            "reason": "ocr low confidence",
            "engine": "ddddocr" if not _dddd_import_failed else "none",
            "confidence": 0.0,
            "decision": "abstain",
            "agreement": 0.0 if agree_gate_enabled() else None,
            "text": "",
        }
        if merge_probe_into_result is not None:
            try:
                hit = merge_probe_into_result(hit)
                # Keep coarse reason for logs; detail lives in abstainReasonDetail.
                if hit.get("decisionReason") and not hit.get("reason"):
                    hit["reason"] = "ocr low confidence"
            except Exception:
                pass

    # Secondary local VLM — default T1 only (primary unsolved).
    try:
        from .vlm import merge_dddd_vlm, should_invoke_vlm, try_vlm

        if should_invoke_vlm(hit):
            vlm_out = try_vlm(img)
            hit = merge_dddd_vlm(hit, vlm_out)
            if hit.get("solved"):
                return hit
    except Exception:
        pass

    # Preserve prior auto/ddddocr fallback: upright grayscale → template after miss.
    if dddd_miss and not colorful and not hit.get("solved"):
        return _solve_template(img)

    hit = dict(hit)
    hit.setdefault("vlmUsed", False)
    if merge_probe_into_result is not None and not hit.get("solved"):
        try:
            hit = merge_probe_into_result(hit)
        except Exception:
            pass
    return hit
