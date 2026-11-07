/* 화면 — criteria.json · keywords.json · data/answer.json 을 읽어서 그린다.
 * 정답이나 낱말은 여기 적지 않는다.
 * AI(Gemini)는 /api/classify 서버 함수를 거쳐서만 부른다. 화면은 열쇠를 모른다.
 * AI가 실패하면 규칙으로 가른다. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const BATCH = 10;   // 채점할 때 한 번에 보내는 문장 수 — 서버가 60초 안에 답하게 작게
  let C = null, K = null, ANSWER = null, LAST = { rules: null, ai: null, aiRaw: null, model: "" };

  /* 고를 수 있는 모델 — Google AI Studio 공식 가격표(aistudio.google.com/docs/pricing, 2026-11-07 확인)에서
   * Free Tier 가 «Free of charge» 인 글쓰기(텍스트) 모델 5개. 음성 · 번역 · 임베딩 · TTS · 이미지 · 영상은 뺐다.
   * 다섯 모두 가격표에 프리뷰 · 지원 중단 표시가 없다. gemini-3.6-flash 만 «이전 세대 Flash» 라고 적혀 있다.
   * 넣지 않은 무료 텍스트 모델: gemini-3-flash-preview (프리뷰 · «legacy»),
   *   gemini-2.5-flash · gemini-2.5-pro (지원 중단 — 2026-12-01 부터 다른 모델로 넘겨짐).
   * 순서는 «추정»이다. 무료 하루 요청 수는 AI Studio 에 로그인해야 보이고, 공식 가격표 · 한도 문서에
   *   모델별 무료 표가 없어 근거를 찾지 못했다. 새 세대 → 가벼운 모델 순으로 늘어놓았을 뿐이다. */
  const MODELS = [
    { id: "gemini-3.8-flash", note: "" },
    { id: "gemini-3.6-flash", note: "이전 세대" },
    { id: "gemini-3.5-flash-lite", note: "" },
    { id: "gemini-3.1-flash-lite", note: "" },
    { id: "gemini-2.5-flash-lite", note: "" },
  ];
  const STORE = "classifier.model";
  const CUSTOM = "__custom__";
  let SERVER_DEFAULT = "";
  const store = {
    get() { try { return localStorage.getItem(STORE) || ""; } catch (e) { return ""; } },
    set(v) { try { localStorage.setItem(STORE, v); } catch (e) { /* 시크릿 창 등 — 기억만 못 할 뿐 앱은 돈다 */ } },
  };

  const load = p => fetch(p, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  Promise.all([load("criteria.json"), load("keywords.json")]).then(([c, k]) => {
    C = c; K = k;
    renderIntro();
    renderWords();
  }).catch(e => { $("#words").textContent = "기준 파일을 읽지 못했어요: " + e.message; });

  /* 소개 카드 — 누가 정한 기준인지, 칸 · 긴급도 범례, 예시 문장. 모두 criteria.json 에서 */
  function renderIntro() {
    $("#owner").textContent = `${C.owner} · 기준 version ${C.version}`;
    const order = [...C.categories].sort((a, b) => a.order - b.order);
    $("#legend-cats").innerHTML = order.map(c => `<span class="chip" title="${esc(c.def)}">${esc(c.name)}</span>`).join("");
    $("#legend-urg").innerHTML = C.urgency.map(u =>
      `<span class="chip u-${esc(u.level)}" title="${esc(u.def)}">${esc(u.level)} · ${esc(u.reply)}</span>`).join("");
    // 예시는 기준 파일의 «예»에서 고른다 — 채점용 문장은 쓰지 않는다
    const picks = order.filter(c => [1, 3, 7, 8].includes(c.order));
    $("#examples").innerHTML = picks.map(c =>
      `<button type="button" class="chip" data-brand="${c.name === "뷰티 상품" ? "B" : "A"}">${esc(c.example)}</button>`).join("");
    $("#examples").addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      $("#text").value = b.textContent;
      const radio = document.querySelector(`input[name="brand"][value="${b.dataset.brand}"]`);
      if (radio) radio.checked = true;
      $("#text").focus();
    });
  }

  /* 탭 */
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(x => {
      const on = x === t;
      x.setAttribute("aria-selected", on);
      $("#" + x.getAttribute("aria-controls")).hidden = !on;
    });
  }));

  /* 규칙 — 가린 문장으로 가른다 */
  function byRules(text, brand) {
    const m = Mask.mask(text);
    return Object.assign(Rules.classify(m.masked, brand, C, K), { masked: m.masked, found: m.found });
  }

  /* 모델 고르기 — «서버 기본값» · 목록 · «직접 입력…». 고른 값은 이 브라우저에 기억한다 */
  const pick = $("#model-pick"), custom = $("#model-custom");
  pick.innerHTML = `<option value="">서버 기본값</option>` +
    MODELS.map(m => `<option value="${esc(m.id)}">${esc(m.id)}${m.note ? ` (${esc(m.note)})` : ""}</option>`).join("") +
    `<option value="${CUSTOM}">직접 입력…</option>`;
  (function restore() {
    const saved = store.get();
    if (!saved) pick.value = "";
    else if (MODELS.some(m => m.id === saved)) pick.value = saved;
    else { pick.value = CUSTOM; custom.value = saved; }
    custom.hidden = pick.value !== CUSTOM;
  })();
  function currentModel() {
    return pick.value === CUSTOM ? custom.value.trim() : pick.value;
  }
  function showModel() {
    const m = currentModel();
    $("#model-now").textContent = pick.value === CUSTOM && !m
      ? "모델 이름을 입력하세요. 비어 있으면 서버 기본값으로 불러요."
      : m ? `지금 호출 모델: ${m}`
        : `지금 호출 모델: 서버 기본값${SERVER_DEFAULT ? ` (${SERVER_DEFAULT})` : " (서버에 닿지 못해 이름을 모름)"}`;
  }
  pick.addEventListener("change", () => {
    custom.hidden = pick.value !== CUSTOM;
    if (!custom.hidden) custom.focus();
    store.set(currentModel());
    showModel();
  });
  custom.addEventListener("input", () => { store.set(currentModel()); showModel(); });
  fetch("api/classify", { cache: "no-store" }).then(r => r.json())
    .then(d => { SERVER_DEFAULT = (d && d.default) || ""; })
    .catch(() => {}).finally(showModel);
  showModel();

  /* AI — 가린 문장 여러 개를 한 번에. 실패하면 {results:null, reason}, 시간 초과면 timeout:true */
  async function askAI(items) {
    try {
      const r = await fetch("api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, model: currentModel() }),
      });
      return await r.json();
    } catch (e) {
      return { results: null, reason: "AI 서버에 닿지 못했습니다 (서버 함수가 없는 로컬에서는 정상)" };
    }
  }

  /* 분류 탭 */
  $("#form").addEventListener("submit", async e => {
    e.preventDefault();
    const text = $("#text").value.trim();
    if (!text || !C) return;
    const brand = document.querySelector('input[name="brand"]:checked').value;
    const btn = $("#form .go");
    btn.disabled = true;
    const rule = byRules(text, brand);
    let ai = await askAI([{ text: rule.masked, brand }]);
    if (ai && ai.timeout) {                       // 느리면 한 번만 더
      btn.textContent = "다시 시도…";
      ai = await askAI([{ text: rule.masked, brand }]);
      btn.textContent = "분류하기";
    }
    const got = ai && ai.results && ai.results[0];
    const r = got || rule;
    const by = $("#r-by");
    by.textContent = got ? `AI(${ai.model})가 갈랐습니다` : `AI 없이 규칙으로 갈랐습니다 — ${ai.reason || "AI가 답하지 않음"}`;
    by.classList.toggle("fallback", !got);
    $("#r-masked").textContent = rule.masked;
    $("#r-cat").textContent = r.category;
    const u = $("#r-urg");
    u.textContent = "긴급도 " + r.urgency;
    u.className = "pill u-" + r.urgency;
    $("#r-reason").textContent = r.reason + (rule.found.length ? ` · 가린 것 ${rule.found.length}개` : "");
    $("#empty").hidden = true;
    $("#result").hidden = false;
    btn.disabled = false;
  });

  function renderWords() {
    const order = [...C.categories].sort((a, b) => a.order - b.order);
    const row = (name, k) => `<dt>${esc(name)}</dt><dd>${(k.words || []).map(esc).join(" · ") || "(낱말 없음 — 아무것도 안 걸리면 여기)"}
      <br>뽑은 곳: ${(k.from || []).map(([w, id]) => `«${esc(w)}» ${esc(id)}`).join(", ")}</dd>`;
    let html = "<dl>" + order.map(c => row(`${c.order}. ${c.name}`, K.categories[c.name] || {})).join("");
    html += ["높음", "보통", "낮음"].map(lv => row(`긴급도 ${lv}`, K.urgency[lv])).join("");
    html += `<dt>긴급도 기본값</dt><dd>${esc(K.urgency.default_note)}: ${
      Object.entries(K.urgency.default).map(([c, u]) => `${esc(c)} ${esc(u)}`).join(" · ")}</dd></dl>`;
    $("#words").innerHTML = html;
  }

  /* 채점 탭 */
  const answers = async () => (ANSWER = ANSWER || await load("data/answer.json"));

  $("#run-rules").addEventListener("click", async () => {
    const btn = $("#run-rules");
    btn.disabled = true;
    try {
      const rows = await answers();
      LAST.rules = Rules.score(rows, r => byRules(r.text, r.brand));
      renderScore(LAST.rules, "규칙");
      renderCompare();
    } catch (e) { $("#progress").textContent = "채점 파일을 읽지 못했어요: " + e.message; }
    finally { btn.disabled = false; }
  });

  $("#run-ai").addEventListener("click", async () => {
    const btn = $("#run-ai"), prog = $("#progress");
    btn.disabled = true;
    try {
      const rows = await answers();
      if (!LAST.rules) LAST.rules = Rules.score(rows, r => byRules(r.text, r.brand));
      const got = new Array(rows.length).fill(null);
      const reasons = [];
      let model = "";
      prog.textContent = `AI 채점 중… 0/${rows.length}`;
      for (let i = 0; i < rows.length; i += BATCH) {
        const part = rows.slice(i, i + BATCH).map(r => ({ text: Mask.mask(r.text).masked, brand: r.brand }));
        let res = await askAI(part);
        if (res && res.timeout) {                 // 느리면 그 묶음만 한 번 더
          btn.textContent = "다시 시도…";
          prog.textContent = `AI가 느려서 ${i + 1}~${i + part.length}번을 다시 보내는 중…`;
          res = await askAI(part);
          btn.textContent = "AI로 채점";
          if (res && res.timeout) {               // 두 번 다 느리면 멈춘다
            prog.textContent = `멈췄어요 — ${res.reason} 다른 모델을 고르거나 잠시 뒤 다시 해 보세요.`;
            return;
          }
        }
        if (res && res.model) model = res.model;
        if (res && res.results) res.results.forEach((x, k) => { got[i + k] = x; });
        else reasons.push(res && res.reason || "AI가 답하지 않음");
        prog.textContent = `AI 채점 중… ${Math.min(i + BATCH, rows.length)}/${rows.length}`;
      }
      const missing = got.filter(x => !x).length;
      const NONE = { category: "(답 없음)", urgency: "(답 없음)", reason: "AI가 답하지 않음 — 오답으로 셈" };
      const s = Rules.score(rows, r => got[rows.indexOf(r)] || NONE);
      s.missing = missing;
      LAST.ai = s; LAST.model = model;
      LAST.aiRaw = rows.map((r, i) => ({ id: r.id, brand: r.brand, text: r.text,
        want: { category: r.category, urgency: r.urgency }, got: got[i] }));
      prog.textContent = missing
        ? `끝 — AI가 답하지 않은 문장 ${missing}개는 오답으로 셌어요. ${reasons[0] || ""}`
        : `끝 — 30개 모두 AI가 답했어요.`;
      renderScore(s, model ? `AI · ${model}` : "AI");
      renderCompare();
    } finally { btn.disabled = false; btn.textContent = "AI로 채점"; }
  });

  function renderScore(s, who) {
    const n = s.n;
    $("#s-which").textContent = `${who} 자세히 (${n}문장)`;
    const w = s.worst;
    $("#s-worst").innerHTML = `
      <li>결제·환불을 다른 칸으로 — <span class="${w.pay ? "bad" : ""}">${w.pay}개</span> / ${w.payTotal}문장 중</li>
      <li>피부 반응(뷰티 상품 · 높음)을 높음이 아닌 긴급도로 — <span class="${w.skin ? "bad" : ""}">${w.skin}개</span> / ${w.skinTotal}문장 중</li>`;
    $("#s-brand").innerHTML = `<tr><th>브랜드</th><th>문장</th><th>칸</th><th>긴급도</th><th>둘 다</th></tr>` +
      Object.entries(s.brands).sort().map(([b, v]) =>
        `<tr><td>${esc(b)}</td><td>${v.n}</td><td>${v.category}</td><td>${v.urgency}</td><td>${v.both}</td></tr>`).join("");
    $("#s-wrong-n").textContent = `${s.wrong.length}개`;
    $("#s-wrong").innerHTML = s.wrong.map(x => {
      const c = x.want.category === x.got.category, u = x.want.urgency === x.got.urgency;
      return `<li><span class="t">${esc(x.id)} · ${esc(x.brand)} · ${esc(x.text)}</span>
        <span class="v">정답 <b>${esc(x.want.category)} · ${esc(x.want.urgency)}</b> → 판정
        <span class="${c ? "" : "x"}">${esc(x.got.category)}</span> · <span class="${u ? "" : "x"}">${esc(x.got.urgency)}</span></span>
        <span class="v">${esc(x.got.reason)}</span></li>`;
    }).join("");
    $("#score").hidden = false;
  }

  /* 규칙 · AI 점수판 — 나란히 두고, 아직 안 쟀으면 «—» */
  function stats(s) {
    const box = (k, v, total, sub, warn) => `<div class="stat${warn ? " warn-stat" : ""}"><span class="s-k">${k}</span>
      <span class="s-v">${v}${total != null ? `<small>/${total}</small>` : ""}</span><span class="s-sub">${sub}</span></div>`;
    if (!s) return ["칸 맞음", "긴급도 맞음", "둘 다 맞음", "결제·환불 놓침"].map(k => box(k, "—", null, "아직 안 쟀어요")).join("");
    const w = s.worst;
    return box("칸 맞음", s.category, s.n, "") + box("긴급도 맞음", s.urgency, s.n, "") +
      box("둘 다 맞음", s.both, s.n, s.missing ? `AI 답 없음 ${s.missing}개 포함` : "") +
      box("결제·환불 놓침", w.pay, w.payTotal, `피부 반응 놓침 ${w.skin}/${w.skinTotal}`, w.pay > 0);
  }
  function renderCompare() {
    $("#stats-rules").innerHTML = stats(LAST.rules);
    $("#stats-ai").innerHTML = stats(LAST.ai);
    $("#ai-model").textContent = LAST.model ? `AI · ${LAST.model}` : "Gemini";
    $("#download").hidden = !LAST.aiRaw;
  }
  renderCompare();

  $("#download").addEventListener("click", () => {
    if (!LAST.aiRaw) return;
    const out = { model: LAST.model, when: new Date().toISOString(),
      score: { category: LAST.ai.category, urgency: LAST.ai.urgency, both: LAST.ai.both, n: LAST.ai.n,
               missing: LAST.ai.missing, worst: LAST.ai.worst, brands: LAST.ai.brands },
      rules: { category: LAST.rules.category, urgency: LAST.rules.urgency, both: LAST.rules.both, worst: LAST.rules.worst },
      items: LAST.aiRaw };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = "ai_채점결과.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
