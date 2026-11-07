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
    renderCriteria();
    renderWords();
  }).catch(e => { $("#owner").textContent = "기준 파일을 읽지 못했어요: " + e.message; });

  /* 기준표 · 예시 — 모두 criteria.json 에서 */
  const urgOf = level => (C && C.urgency.find(u => u.level === level)) || {};
  function renderCriteria() {
    $("#owner").textContent = `${C.owner} · 기준 v${C.version}`;
    const order = [...C.categories].sort((a, b) => a.order - b.order);
    $("#crit-cats").innerHTML = order.map(c =>
      `<tr><td class="ord">${c.order}</td><td>${esc(c.name)}</td><td>${esc(c.def)}</td></tr>`).join("");
    $("#crit-urg").innerHTML = C.urgency.map(u =>
      `<tr><td><span class="status u-${esc(u.level)}">${esc(u.level)}</span></td><td>${esc(u.def)}</td><td style="white-space:nowrap">${esc(u.reply)}</td></tr>`).join("");
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
      ? "모델 이름을 입력하세요 (비우면 서버 기본값)"
      : m ? `호출 모델 ${m}`
        : `호출 모델 서버 기본값${SERVER_DEFAULT ? ` (${SERVER_DEFAULT})` : " (서버에 연결하지 못해 이름을 알 수 없음)"}`;
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
      return { results: null, reason: "AI 서버에 연결하지 못했어요 (서버 함수가 없는 로컬이면 정상)" };
    }
  }

  /* 받은 글 — 이 창에만 쌓는다. 새로 고치면 사라진다(저장하지 않음) */
  const ITEMS = [];
  let FILTER = "all", SEL = null, SEQ = 0;
  const RANK = { "높음": 0, "보통": 1, "낮음": 2 };

  // 한 번에 여러 글을 가른다 — AI 먼저, 안 되면 그 글은 규칙으로
  async function classifyMany(list, btn) {
    const rules = list.map(x => byRules(x.text, x.brand));
    let ai = await askAI(rules.map((r, i) => ({ text: r.masked, brand: list[i].brand })));
    if (ai && ai.timeout) {                       // 느리면 한 번만 더
      if (btn) btn.textContent = "다시 시도 중…";
      ai = await askAI(rules.map((r, i) => ({ text: r.masked, brand: list[i].brand })));
    }
    return list.map((x, i) => {
      const got = ai && ai.results && ai.results[i];
      const r = got || rules[i];
      return { id: ++SEQ, brand: x.brand, masked: rules[i].masked, found: rules[i].found.length,
        category: r.category, urgency: r.urgency, reason: r.reason,
        by: got ? `AI · ${ai.model}` : "규칙", fallbackWhy: got ? "" : (ai && ai.reason) || "AI가 답하지 않음",
        at: new Date() };
    });
  }

  $("#form").addEventListener("submit", async e => {
    e.preventDefault();
    const text = $("#text").value.trim();
    if (!text || !C) return;
    const brand = document.querySelector('input[name="brand"]:checked').value;
    const btn = $("#form .btn.primary");
    btn.disabled = true;
    const [item] = await classifyMany([{ text, brand }], btn);
    btn.textContent = "분류"; btn.disabled = false;
    ITEMS.push(item); SEL = item.id;
    $("#text").value = "";
    renderInbox();
  });

  $("#load-examples").addEventListener("click", async () => {
    if (!C) return;
    const b = $("#load-examples");
    b.disabled = true; b.textContent = "분류 중…";
    // 예시는 기준 파일의 «예»에서 고른다 — 채점용 문장은 쓰지 않는다
    const picks = [...C.categories].sort((a, c) => a.order - c.order).filter(c => [1, 3, 7, 8].includes(c.order))
      .map(c => ({ text: c.example, brand: c.name === "뷰티 상품" ? "B" : "A" }));
    const items = await classifyMany(picks);
    ITEMS.push(...items); SEL = items[0].id;
    b.disabled = false; b.textContent = "예시 4개 넣기";
    renderInbox();
  });

  document.querySelectorAll(".filters button").forEach(b => b.addEventListener("click", () => {
    FILTER = b.dataset.f;
    document.querySelectorAll(".filters button").forEach(x => x.setAttribute("aria-pressed", x === b));
    renderInbox();
  }));

  $("#rows").addEventListener("click", e => {
    const b = e.target.closest("button.row");
    if (!b) return;
    SEL = +b.dataset.id;
    renderInbox();
  });

  const hhmm = d => d.toTimeString().slice(0, 5);
  const brandName = b => ({ A: "A · 포토부스", B: "B · 뷰티 + 스튜디오" }[b] || "모름");

  function renderInbox() {
    const shown = ITEMS.filter(x => FILTER === "all" || x.urgency === FILTER || x.brand === FILTER)
      .sort((a, b) => (RANK[a.urgency] - RANK[b.urgency]) || (b.id - a.id));   // 급한 글이 위로, 같으면 최근 것
    $("#count").textContent = `${ITEMS.length}건`;
    const hi = ITEMS.filter(x => x.urgency === "높음").length;
    $("#hi-count").hidden = !hi;
    $("#hi-count").textContent = `높음 ${hi}`;
    $("#list-empty").hidden = ITEMS.length > 0;
    $("#rows").innerHTML = shown.map(x => `<li><button type="button" class="row" data-id="${x.id}" aria-current="${x.id === SEL}">
        <span class="t">${esc(x.masked)}</span>
        <span class="m"><span class="status u-${esc(x.urgency)}">${esc(x.urgency)}</span><span class="cat">${esc(x.category)}</span><span>${esc(x.brand)} · ${hhmm(x.at)}</span></span>
      </button></li>`).join("") || (ITEMS.length ? `<li class="list-empty"><p>이 조건에 맞는 글이 없어요.</p></li>` : "");
    renderDetail(ITEMS.find(x => x.id === SEL));
  }

  function renderDetail(x) {
    $("#detail-empty").hidden = !!x;
    $("#detail").hidden = !x;
    const dd = [...document.querySelectorAll("#props dd")];
    if (!x) { dd.forEach(d => { d.textContent = "—"; }); return; }
    $("#d-meta").textContent = `#${String(x.id).padStart(2, "0")} · ${brandName(x.brand)} · ${hhmm(x.at)}${x.found ? ` · 가린 것 ${x.found}개` : ""}`;
    $("#d-msg").textContent = x.masked;
    const by = $("#d-by");
    by.textContent = x.by === "규칙" ? `규칙으로 분류 — ${x.fallbackWhy}` : x.by;
    by.classList.toggle("fallback", x.by === "규칙");
    $("#d-reason").textContent = x.reason;
    const cat = C.categories.find(c => c.name === x.category);
    dd[0].innerHTML = `<span class="big">${esc(x.category)}</span>${cat ? ` <span class="muted small">순서 ${cat.order}</span>` : ""}`;
    dd[1].innerHTML = `<span class="status u-${esc(x.urgency)}">${esc(x.urgency)}</span>`;
    dd[2].textContent = urgOf(x.urgency).reply || "—";
    dd[3].textContent = brandName(x.brand);
    dd[4].textContent = x.by === "규칙" ? "규칙 (AI 실패)" : x.by;
  }
  renderInbox();

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

  /* 채점 */
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
          btn.textContent = "다시 시도 중…";
          prog.textContent = `AI 응답이 느려 ${i + 1}~${i + part.length}번을 다시 보내는 중…`;
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
      const NONE = { category: "(답 없음)", urgency: "(답 없음)", reason: "AI 답 없음 — 오답 처리" };
      const s = Rules.score(rows, r => got[rows.indexOf(r)] || NONE);
      s.missing = missing;
      LAST.ai = s; LAST.model = model;
      LAST.aiRaw = rows.map((r, i) => ({ id: r.id, brand: r.brand, text: r.text,
        want: { category: r.category, urgency: r.urgency }, got: got[i] }));
      prog.textContent = missing
        ? `완료 — AI가 답하지 않은 문장 ${missing}개는 오답으로 셌어요. ${reasons[0] || ""}`
        : `완료 — 30개 모두 AI가 답했어요.`;
      renderScore(s, model ? `AI · ${model}` : "AI");
      renderCompare();
    } finally { btn.disabled = false; btn.textContent = "AI로 채점"; }
  });

  /* 규칙 vs AI 표 — 아직 안 쟀으면 «—» */
  function renderCompare() {
    const R = LAST.rules, A = LAST.ai;
    // 맞음은 많을수록, 놓침 · 답 없음은 적을수록 좋다
    const rows = [
      ["칸 맞음", s => s.category, s => s.n, 1, true],
      ["긴급도 맞음", s => s.urgency, s => s.n, 1, true],
      ["둘 다 맞음", s => s.both, s => s.n, 1, true],
      ["안전·사고를 다른 칸으로 놓침", s => s.worst.safe, s => s.worst.safeTotal, -1, true],
      ["결제·환불을 다른 칸으로 놓침", s => s.worst.pay, s => s.worst.payTotal, -1, true],
      ["피부 반응을 높음이 아닌 긴급도로 놓침", s => s.worst.skin, s => s.worst.skinTotal, -1, false],
      ["AI 답 없음", s => s.missing ?? 0, null, -1, false],
    ];
    $("#c-table").innerHTML = rows.map(([label, v, total, dir, key]) => {
      const rv = R ? v(R) : null, av = A ? v(A) : null;
      const cls = (mine, other) => (mine == null || other == null || mine === other) ? ""
        : ((mine - other) * dir > 0 ? "better" : "worse");
      const cell = (s, val, other) => s
        ? `<td class="num ${label === "AI 답 없음" ? "" : cls(val, other)}">${val}${total ? `<span class="muted"> / ${total(s)}</span>` : ""}</td>`
        : `<td class="num muted">—</td>`;
      const rCell = label === "AI 답 없음" ? `<td class="num muted">—</td>` : cell(R, rv, av);
      return `<tr${key ? ' class="key"' : ""}><td>${label}</td>${rCell}${cell(A, av, rv)}</tr>`;
    }).join("");
    $("#ai-col").textContent = LAST.model ? `AI · ${LAST.model}` : "AI";
    $("#dl-foot").hidden = !LAST.aiRaw;
  }
  renderCompare();

  function renderScore(s, who) {
    const n = s.n;
    $("#s-which").textContent = `${who} — 자세히 (${n}문장)`;
    const w = s.worst;
    $("#s-worst").innerHTML = `
      <li>안전·사고를 다른 칸으로 — ${w.safeTotal}문장 중 <span class="${w.safe ? "bad" : ""}">${w.safe}개</span></li>
      <li>결제·환불을 다른 칸으로 — ${w.payTotal}문장 중 <span class="${w.pay ? "bad" : ""}">${w.pay}개</span></li>
      <li>피부 반응(뷰티 상품 · 높음)을 높음이 아닌 긴급도로 — ${w.skinTotal}문장 중 <span class="${w.skin ? "bad" : ""}">${w.skin}개</span></li>`;
    $("#s-brand").innerHTML = `<thead><tr><th>브랜드</th><th class="num">문장</th><th class="num">칸</th><th class="num">긴급도</th><th class="num">둘 다</th></tr></thead><tbody>` +
      Object.entries(s.brands).sort().map(([b, v]) =>
        `<tr><td>${esc(b)}</td><td class="num">${v.n}</td><td class="num">${v.category}</td><td class="num">${v.urgency}</td><td class="num">${v.both}</td></tr>`).join("") + "</tbody>";
    $("#s-wrong-n").textContent = `${s.wrong.length}개`;
    $("#s-wrong").innerHTML = s.wrong.map(x => {
      const c = x.want.category === x.got.category, u = x.want.urgency === x.got.urgency;
      return `<tr><td>${esc(x.id)} · ${esc(x.brand)}</td><td>${esc(x.text)}</td>
        <td>${esc(x.want.category)} · ${esc(x.want.urgency)}</td>
        <td><span class="${c ? "" : "x"}">${esc(x.got.category)}</span> · <span class="${u ? "" : "x"}">${esc(x.got.urgency)}</span>
          <span class="why-s">${esc(x.got.reason)}</span></td></tr>`;
    }).join("");
    $("#score").hidden = false;
  }

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
