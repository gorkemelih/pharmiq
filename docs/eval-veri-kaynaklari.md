# PharmIQ — Eval Veri Kaynakları Araştırması

> Tarih: 2026-06-02 · Kaynak: `/deep-research` (108 ajan, 25 kaynak, 21 doğrulanmış iddia) + HF doğrulaması.
> Amaç: recordati.pdf yerine **amaca uygun korpus + golden set** bulmak. Bu dosya = karar referansı.

---

## 1. KORPUS (RAG bilgi tabanı) — ücretsiz/açık ilaç belgeleri

| Kaynak | İçerik | Dil | Lisans | Erişim |
|---|---|---|---|---|
| **openFDA drug labeling** ⭐ | FDA ilaç etiketleri (endikasyon, yan etki, doz) — SmPC benzeri | EN | **CC0 public domain** (ticari dahil serbest, atıf şart değil) — en temiz | API: `api.fda.gov/drug/label.json` · bulk zip index: `api.fda.gov/download.json` |
| **EMA EPAR / SmPC** | AB merkezi onaylı ilaçların değerlendirme + ürün bilgisi (SmPC) | EN | Ticari+non-ticari serbest AMA **her kopyada EMA atfı ZORUNLU** + üçüncü-taraf içerik HARİÇ (MLR gotcha) | ema.europa.eu (download medicine data; ePI API anahtarsız) |
| **TİTCK KÜB/KT** ⭐(TR) | KÜB (=SmPC) + KT (=prospektüs) PDF'leri — resmi/otoriter | TR | ⚠️ **Açık lisans YOK** → erişim serbest, redistribute/eğitim hakkı belirsiz | titck.gov.tr/kubkt → satır linkleri `titck.gov.tr/storage/kubKtAttachments/<id>.pdf` (authsız). Not: tablo JS-render, scrape için headless gerek |
| ~~vapi.co (Vademecum)~~ | ~20K ilaç | TR | ❌ **Ücretli/proprietary** (4.4K–24K TL/yıl) — uygun DEĞİL | — |
| ~~DailyMed~~ | — | — | Doğrulamada **çürütüldü** → İngilizce için openFDA kullan | — |

**Lisans hijyeni:** openFDA = en serbest (CC0). EMA = kullan ama her kopyada "Kaynak: EMA" + üçüncü-taraf içeriği ayıkla. TİTCK = "erişilebilir, yeniden-yayın izni teyitsiz" → README'de **kaynak** olarak belirt, redistribute etmeden önce TİTCK/KVKK teyit et.

---

## 2. HAZIR EVAL VERİ SETLERİ

| Set | Boyut | Format | Dil | Lisans | RAGAS'a uygun mu? |
|---|---|---|---|---|---|
| **PubMedQA** ⭐ (EN) | ~1K etiketli (+211K yapay) | question + **context (gold passage)** + long_answer + yes/no/maybe | EN | **MIT** | ✅ **Birebir** (faithfulness/context-precision/answer-correctness alanları hazır) |
| **MedTurkQuAD** ⭐ (TR) | 8.2K (6.6K/820/820) | **context + question + answers** (SQuAD tarzı) | TR | cc-by-nc-nd-4.0 | ✅ Yapı uygun; ⚠️ NC-ND → **non-ticari/portföy eval'de as-is + atıf** |
| turkish_medical_reasoning (TR) | 7.2K | question + answer + reasoning (**kaynak pasaj YOK**) | TR | — | Kısmi: answer kalitesi ✓, context-precision ✗ |
| turkish_mmlu | 100K+ | MCQ, **gated** | TR | cc-by-nc-nd | ✗ (MCQ + gated) |
| MIRAGE / MedRAG | 7.663 Q | MCQ/yes-no, gold passage YOK | EN | — | ✗ doğrudan RAGAS sürmez (retrieval/accuracy benchmark'ı) |

**Türkçe PHARMA/ilaç (prospektüs/KÜB) hazır QA seti: YOK** → TİTCK belgelerinden elle kurulacak.

---

## 3. GOLDEN SET — best practice (RAGAS)

- **Şema:** `question` + `gold context passage` + `reference answer` (PubMedQA/MedTurkQuAD şeması).
- **Cevaplanabilirlik:** her soru korpustan cevaplanabilmeli — yoksa faithfulness/precision yanıltıcı.
- **Boyut:** onlarca–yüzlerce. **Küçük korpus context_precision'ı bozar** (bizim 9-chunk / 0.33 sorunumuz tam buydu — yeterli "distractor" yoktu).
- **Üretim:** sentetik (RAGAS testset generation) + insan-küratör karışımı.

---

## 4. PharmIQ için ÖNERİLEN PLAN

1. **Korpus:** recordati.pdf'i çıkar → **openFDA** (EN, CC0) + **TİTCK KÜB/KT** (TR) ile ~30–100 gerçek ilaç belgesi ingest et. Hem demoyu gerçekçi yapar hem context_precision'ı düzeltir (yeterli distractor).
2. **İngilizce eval:** PubMedQA `pqa_labeled`'dan golden set.
3. **Türkçe eval:** **MedTurkQuAD** (hazır) + TİTCK belgelerinden elle ~20–30 pharma sorusu (off-label/doz/endikasyon — MLR hikayesini güçlendirir).
4. **Lisans:** openFDA CC0 (serbest) · EMA (atıf zorunlu) · TİTCK (kaynak belirt, redistribute teyitli değil) · MedTurkQuAD (NC-ND → portföy eval as-is + atıf).

## 5. Açık sorular (sonra netleşecek)
- TİTCK KÜB/KT'nin AI-eğitim/redistribute izni? (sayfada açık lisans yok — teyit gerek)
- BioASQ / MedQA / MedMCQA bağımsız lisans/boyutları (MIRAGE içinde geçti, tek tek doğrulanmadı)
- EMA EPAR'da hangi bölümler üçüncü-taraf telifli (ingestion'da ayıklanmalı)

## Kaynaklar (doğrulanmış)
openFDA: open.fda.gov/apis/drug/label, /license, /apis/downloads · EMA: ema.europa.eu/.../legal-notice, /glossary-terms/european-public-assessment-report · TİTCK: titck.gov.tr/kubkt · PubMedQA: hf.co/datasets/qiaojin/PubMedQA (MIT) · MedTurkQuAD: hf.co/datasets/incidelen/MedTurkQuAD · MIRAGE: arxiv.org/abs/2402.13178 · RAGAS: docs.ragas.io
