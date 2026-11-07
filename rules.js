/* 규칙 분류기 — AI 없이, criteria.json 의 칸 순서와 keywords.json 의 낱말만으로 가른다.
 * 이것이 기준선이다. AI 가 이 점수보다 못하면 AI 를 쓸 이유가 없다.
 * 낱말과 정답은 여기 적지 않는다 — 모두 JSON 에서 읽는다.
 * 브라우저(window.Rules)와 node(require) 둘 다에서 쓴다. */
(function (root) {
  "use strict";

  const hit = (t, words) => (words || []).find(w => t.includes(w.toLowerCase())) || null;

  // «환불»이 / «결제»가 — 받침에 맞는 조사
  function iga(word) {
    const c = String(word).trim().slice(-1).charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? "이" : "가";
    return "이(가)";
  }

  /* text 는 이미 가린 문장. brand 는 A · B · 모름 */
  function classify(text, brand, criteria, keywords) {
    const t = String(text || "").toLowerCase();
    const order = [...criteria.categories].sort((a, b) => a.order - b.order);

    // 칸 — 순서대로 훑어서 처음 걸리는 칸
    let category = "기타", why = "어느 칸의 낱말도 없어서 «기타»";
    for (const c of order) {
      const k = keywords.categories[c.name] || {};
      if (k.brands && !k.brands.includes(brand || "모름")) continue;   // 뷰티 상품은 B · 모름만
      const w = hit(t, k.words);
      if (w) { category = c.name; why = `«${w}»${iga(w)} 있어서 «${c.name}» (순서 ${c.order})`; break; }
    }

    // 긴급도 — 높음 → 보통 → 낮음 낱말, 없으면 칸의 기본값
    const U = keywords.urgency;
    let urgency = null, uwhy = "";
    for (const lv of ["높음", "보통", "낮음"]) {
      const w = hit(t, U[lv].words);
      if (w) { urgency = lv; uwhy = `«${w}» → ${lv}`; break; }
    }
    if (!urgency) { urgency = U.default[category] || "낮음"; uwhy = `칸 기본값 → ${urgency}`; }

    return { category, urgency, reason: `${why} · 긴급도 ${uwhy}`, by: "규칙" };
  }

  /* rows = answer.json. predict(row) → {category, urgency}. 가장 나쁜 실수 둘도 센다 */
  function score(rows, predict) {
    const out = { n: rows.length, category: 0, urgency: 0, both: 0, wrong: [], brands: {},
                  worst: { pay: 0, payTotal: 0, skin: 0, skinTotal: 0, safe: 0, safeTotal: 0 } };
    for (const r of rows) {
      const p = predict(r);
      const okC = p.category === r.category, okU = p.urgency === r.urgency;
      out.category += okC; out.urgency += okU; out.both += okC && okU;
      const b = out.brands[r.brand] || (out.brands[r.brand] = { n: 0, category: 0, urgency: 0, both: 0 });
      b.n += 1; b.category += okC; b.urgency += okU; b.both += okC && okU;
      if (r.category === "안전·사고") { out.worst.safeTotal += 1; if (!okC) out.worst.safe += 1; }
      if (r.category === "결제·환불") { out.worst.payTotal += 1; if (!okC) out.worst.pay += 1; }
      if (r.category === "뷰티 상품" && r.urgency === "높음") {
        out.worst.skinTotal += 1; if (p.urgency !== "높음") out.worst.skin += 1;
      }
      if (!(okC && okU)) out.wrong.push({ id: r.id, brand: r.brand, text: r.text, want: r, got: p });
    }
    return out;
  }

  const api = { classify, score };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Rules = api;
})(this);
