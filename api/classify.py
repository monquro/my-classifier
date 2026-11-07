# -*- coding: utf-8 -*-
"""Gemini 분류 — Vercel 서버 함수. 열쇠를 숨기기 위해 있는 유일한 서버다.

  받는 것   POST {"items": [{"text": "가린 문장", "brand": "A|B|모름"}, ... 최대 10개],
                  "model": "모델 이름" — 비우면 서버 기본값}
  주는 것   {"results": [{"category", "urgency", "reason", "by": "AI"} 또는 null, ...], "model": "쓴 모델"}
            실패하면 {"results": null, "reason": "..."} — 200 으로 돌려주고, 화면은 규칙으로 가른다.
            시간 초과면 "timeout": true 를 더한다 — 화면이 그 묶음만 한 번 더 보낸다.
            GET 이면 {"default": "서버 기본 모델"} 만 준다. 열쇠는 절대 돌려주지 않는다.

- 열쇠는 환경 변수 GEMINI_API_KEY 에만 있다.
- 모델: 요청의 "model" → 환경 변수 GEMINI_MODEL → 코드 기본값(gemini-3.5-flash-lite) 순서.
  모델 이름은 호출 주소에 들어가므로 MODEL_RE 로 엄격히 검사하고, 맞지 않으면 AI 를 부르지 않는다.
- 기준은 화면이 보내지 않는다. 서버가 함께 배포된 criteria.json 을 직접 읽는다
  (화면이 보내는 기준을 그대로 쓰면, 누구나 우리 열쇠로 아무 질문이나 시킬 수 있다).
- 문장은 브라우저에서 이미 가려져서 온다(mask.js). 여기서 다시 가리지 않는다.
- 한도: 한 번에 10개, 문장당 500자. 링크가 퍼졌을 때 비용이 새는 것을 줄인다.
- 파이썬 표준 라이브러리만 쓴다.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

DEFAULT_MODEL = "gemini-3.5-flash-lite"
# 모델 이름은 호출 주소에 그대로 들어간다 — 글자를 엄격히 제한해 주소를 비틀지 못하게 한다
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$")
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT = 60
RETRY_WAITS = [2, 5]          # 500 · 503 일 때 다시 하기 전에 기다리는 초
MAX_ITEMS = 10
MAX_LEN = 500
BRANDS = {"A", "B", "모름"}
CRITERIA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "criteria.json")


def load_criteria():
    with open(CRITERIA_PATH, encoding="utf-8") as f:
        return json.load(f)


def build_prompt(items, c):
    order = sorted(c["categories"], key=lambda x: x["order"])
    cats = "\n".join(f"  {x['order']}. {x['name']}: {x['def']} (예: {x['example']})" for x in order)
    edges = "\n".join(f"  - {e['text']} → {e['category']} ({e['why']})" for e in c.get("edge_cases", []))
    urg = "\n".join(f"  - {u['level']}: {u['def']}" for u in c["urgency"])
    brands = "\n".join(f"  - {b['id']}: {b['desc']}" for b in c.get("brands", []))
    lines = "\n".join(f"{i}: [{it['brand']}] {it['text']}" for i, it in enumerate(items))
    return f"""너는 매장 두 곳(브랜드 A · B)의 고객 글을 분류하는 본사 담당자다.
아래 기준을 그대로 따른다. 기준에 없는 판단을 더하지 않는다. 낱말이 아니라 글의 뜻으로 판단한다.

[브랜드] 문장 앞 [] 안에 적혀 있다. 맞히지 않는다.
{brands}
  {c.get('brand_rule', '')}

[칸 — 하나만 고른다. 번호가 작을수록 먼저]
{cats}
  {c.get('order_rule', '')}
  순서의 이유: {c.get('order_reason', '')}

[헷갈리는 경우]
{edges}

[긴급도 — 높음 · 보통 · 낮음]
{urg}

[가장 나쁜 실수 — 특히 피한다]
  {c.get('worst_mistake', '')}

[이름] [전화번호] [이메일] [주문번호] 는 가려진 개인정보다. 추측하지 않는다.

문장마다 아래 모양의 JSON 배열 하나로만 답한다. 설명을 덧붙이지 않는다.
[{{"i": 0, "category": "칸 이름", "urgency": "높음|보통|낮음", "reason": "왜 그렇게 골랐는지 한 문장"}}]

[문장]
{lines}
"""


def call_gemini(key, model, prompt):
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT.format(model=model), data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for wait in RETRY_WAITS + [None]:
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = json.loads(r.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if wait is None or e.code not in (500, 503):
                raise
            time.sleep(wait)
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])


def clean(answer, n, c):
    """기준 안의 값만 받는다. 기준 밖의 칸 · 긴급도는 버리고 그 문장은 null 로 둔다."""
    cats = {x["name"] for x in c["categories"]}
    urgs = {u["level"] for u in c["urgency"]}
    out = [None] * n
    for it in answer if isinstance(answer, list) else []:
        try:
            i = int(it.get("i"))
        except (TypeError, ValueError, AttributeError):
            continue
        if 0 <= i < n and it.get("category") in cats and it.get("urgency") in urgs:
            out[i] = {"category": it["category"], "urgency": it["urgency"],
                      "reason": str(it.get("reason", ""))[:200], "by": "AI"}
    return out


def is_timeout(e):
    if isinstance(e, TimeoutError):
        return True
    return isinstance(e, urllib.error.URLError) and isinstance(getattr(e, "reason", None), TimeoutError)


def model_name():
    """서버 기본 모델 — GEMINI_MODEL, 없으면 코드 기본값."""
    return os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL


def pick_model(asked):
    """요청의 모델 → 서버 기본 모델. 이름이 규칙에 맞지 않으면 None."""
    name = str(asked or "").strip() or model_name()
    return name if MODEL_RE.fullmatch(name) else None


class handler(BaseHTTPRequestHandler):
    def _send(self, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        return self._send({"default": model_name()})

    def do_POST(self):
        model = None
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 20000)).decode("utf-8"))
            if not isinstance(req, dict):
                return self._send({"results": None, "reason": "요청 모양이 맞지 않아요"})
            model = pick_model(req.get("model"))
            if model is None:
                return self._send({"results": None,
                                   "reason": "모델 이름이 올바르지 않아요 — 영문 · 숫자 · . _ - 만, 64자까지"})
            raw = req.get("items")
            if not isinstance(raw, list) or not raw:
                return self._send({"results": None, "reason": "보낸 문장이 없어요"})
            if len(raw) > MAX_ITEMS:
                return self._send({"results": None, "reason": f"한 번에 {MAX_ITEMS}개까지만 받아요"})
            items = []
            for it in raw:
                it = it if isinstance(it, dict) else {}
                brand = it.get("brand") if it.get("brand") in BRANDS else "모름"
                items.append({"text": str(it.get("text", ""))[:MAX_LEN], "brand": brand})
            key = os.environ.get("GEMINI_API_KEY", "").strip()
            if not key:
                return self._send({"results": None, "reason": "열쇠가 없어요 — Vercel 환경 변수 GEMINI_API_KEY"})
            c = load_criteria()
            answer = call_gemini(key, model, build_prompt(items, c))
            return self._send({"results": clean(answer, len(items), c), "model": model})
        except urllib.error.HTTPError as e:
            why = {404: "모델 이름을 확인해 주세요.", 429: "무료 한도를 넘었어요. 잠시 뒤 다시 해 보세요.",
                   500: "Gemini 쪽 오류예요. 잠시 뒤 다시 해 보세요.", 503: "Gemini가 붐벼요. 잠시 뒤 다시 해 보세요."}
            # Gemini 가 돌려준 오류 문장(열쇠는 들어 있지 않다)을 짧게 붙인다 — 400 의 원인을 알기 위해
            try:
                detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")[:160]
            except Exception:  # noqa: BLE001
                detail = ""
            return self._send({"results": None, "model": model,
                               "reason": f"AI 호출 실패 ({e.code}, {model}) — {why.get(e.code, '모델 이름과 한도를 확인해 주세요.')}"
                                         + (f" · {detail}" if detail else "")})
        except Exception as e:  # noqa: BLE001
            if is_timeout(e):
                return self._send({"results": None, "timeout": True, "model": model,
                                   "reason": f"AI가 {TIMEOUT}초 안에 답하지 않았어요 — 모델({model})이 느리거나 혼잡해요"})
            return self._send({"results": None, "model": model,
                               "reason": f"AI 호출 실패 ({model}) — {type(e).__name__}"})
