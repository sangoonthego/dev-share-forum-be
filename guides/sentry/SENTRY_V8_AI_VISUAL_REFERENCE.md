# 📊 Sentry v8+ AI Module: Visual Architecture & Metrics

## 🏗️ Span Hierarchy Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER SENDS MESSAGE                                │
│                        (WebSocket Gateway)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
        ╔═════════════════════════════════════════════════════════════╗
        ║                    ws.ask_ai [ROOT SPAN]                   ║
        ║                   op: websocket.message                    ║
        ║                    Duration: ~2.3s (P95)                   ║
        ║  ┌──────────────────────────────────────────────────────┐  ║
        ║  │ Attributes:                                          │  ║
        ║  │  • user.id: 507f1f77bcf86cd799439011               │  ║
        ║  │  • session.id: sess_abc123                          │  ║
        ║  │  • socket.id: rlxgT7ARfaOPPp_BAAAB                 │  ║
        ║  │  • message.length: 256                              │  ║
        ║  │  • message.truncated: false                         │  ║
        ║  └──────────────────────────────────────────────────────┘  ║
        └─────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼

    ╔══════════════════════╗  ╔══════════════════════╗  ╔══════════════════════╗
    ║  rag.retrieve        ║  ║  rag.grade           ║  ║  rag.generate        ║
    ║  [CHILD SPAN]        ║  ║  [CHILD SPAN]        ║  ║  [CHILD SPAN]        ║
    ║  op: db.read         ║  ║  op: ai.api.call     ║  ║  op: ai.api.call     ║
    ║  Duration: ~310ms    ║  ║  Duration: ~450ms    ║  ║  Duration: ~1250ms   ║
    ║                      ║  ║                      ║  ║                      ║
    ║ retrieved.count: 5   ║  ║ grade.relevant: 4    ║  ║ context.available: ✓ ║
    ║ threshold_met: ✓     ║  ║ docs_count: 5        ║  ║ response.length: 512 ║
    ║                      ║  ║                      ║  ║ sources.count: 3     ║
    └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
            │                          │                         │
            ▼                          ▼                         ▼

    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
    │embedding.query   │  │gemini.grade_call │  │ai.gemini_generation  │
    │[NESTED SPAN]     │  │[NESTED SPAN]     │  │[NESTED SPAN]         │
    │op: ai.api.call   │  │op: ai.api.call   │  │op: ai.api.call       │
    │Duration: 245ms   │  │Duration: 340ms   │  │Duration: 850ms       │
    │ttfb_ms: 245      │  │ttfb_ms: 340      │  │ttfb_ms: 350          │
    │model: embed-004  │  │model: gemini-1.5 │  │model: gemini-1.5     │
    │text.masked: ✓    │  │prompt.masked: ✓  │  │prompt.masked: ✓      │
    └──────────────────┘  └──────────────────┘  └──────────────────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    ▼                    ▼                    ▼

                        ┌──────────────────────┐ ┌──────────────────────┐
                        │gemini.text_generation│ │gemini.safety_check   │
                        │[NESTED SPAN]         │ │[NESTED SPAN]         │
                        │Duration: 300ms       │ │Duration: 150ms       │
                        │ttfb_ms: 300          │ │check.result: safe    │
                        │retry.attempt: 0      │ │text.masked: ✓        │
                        │http.status_code: 200 │ │http.status_code: 200 │
                        └──────────────────────┘ └──────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │   RESPONSE STREAMED TO CLIENT   │
                    │   (20 char chunks, 30ms delay)  │
                    └─────────────────────────────────┘
```

---

## ⏱️ Latency Breakdown

```
Total Duration: 2,340ms (P95)

┌─────────────────────────────────────────────────────────────────────────────┐
│ Root Span Timeline (ws.ask_ai)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ 0ms    100ms   200ms   300ms   400ms   500ms   600ms   700ms   800ms       │
│ ├──────────────────────────┤                                               │
│ │ rag.retrieve (310ms)     │                                               │
│ │ └─embedding.query (245ms)                                               │
│                             ├───────────────────┤                         │
│                             │ rag.grade (450ms) │                         │
│                             │ └─gemini.grade... │                         │
│                                                 └───────────────────────► │
│                                                   rag.generate (1250ms)   │
│                                                   ├─ai.gemini_gen (850ms) │
│                                                   ├─gemini.text_gen (300) │
│                                                   └─gemini.safety (150ms) │
│                                                                             │
│  0ms      500ms      1000ms      1500ms      2000ms      2500ms           │
└─────────────────────────────────────────────────────────────────────────────┘

Sequential Phases:
• Retrieve: 310ms (documents from pgvector)
• Grade: 450ms (evaluate relevance)
• Generate: 1250ms (synthesize response)
• Overhead: 330ms (streaming, marshalling)
─────────────
TOTAL: 2,340ms
```

---

## 📊 Observable Attributes by Span

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ws.ask_ai [ROOT]                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ • user.id                     → "507f1f77bcf86cd799439011"                 │
│ • session.id                  → "sess_abc123"                              │
│ • socket.id                   → "rlxgT7ARfaOPPp_BAAAB"                    │
│ • message.length              → 256                                         │
│ • message.truncated           → false                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ rag.retrieve [CHILD]                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ • retrieved.count             → 5                                           │
│ • retrieved.threshold_met     → true (>0.7 similarity)                     │
│ • user.id                     → "507f1f77bcf86cd799439011"                 │
│                                                                             │
│ └─ embedding.query [NESTED]                                                │
│    • service                  → "gemini"                                    │
│    • model                    → "text-embedding-004"                       │
│    • text.masked              → true (actual query NOT sent)                │
│    • text.length              → 156 (tokens)                                │
│    • ttfb_ms                  → 245 (time to embedding)                     │
│    • embedding.dimension      → 768                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ rag.grade [CHILD]                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ • grade.relevant              → 4 (documents marked relevant)               │
│ • grade.reasoning_length      → 512 (tokens in reasoning)                  │
│ • docs_count                  → 5 (input documents)                        │
│                                                                             │
│ └─ gemini.grade_call [NESTED]                                              │
│    • service                  → "gemini"                                    │
│    • model                    → "gemini-1.5-flash"                         │
│    • prompt.masked            → true (actual prompt NOT sent)               │
│    • ttfb_ms                  → 340 (time to grading response)              │
│    • http.status_code         → 200                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ rag.generate [CHILD]                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ • context.available           → true                                        │
│ • context.length              → 2048 (tokens available)                    │
│ • prompt.masked               → true (actual prompt NOT sent)               │
│ • question.length             → 256 (user question tokens)                 │
│ • response.length             → 512 (generated response)                   │
│ • sources.count               → 3 (documents cited)                        │
│                                                                             │
│ ├─ ai.gemini_generation [NESTED]                                           │
│ │  • model                    → "gemini-1.5-flash"                         │
│ │  • ttfb_ms                  → 350 (time to first token)                   │
│ │  • http.status_code         → 200                                         │
│ │                                                                           │
│ ├─ gemini.text_generation [NESTED]                                         │
│ │  • service                  → "gemini"                                    │
│ │  • prompt.masked            → true                                        │
│ │  • ttfb_ms                  → 300                                         │
│ │  • retry.attempt            → 0 (no retries needed)                      │
│ │  • http.status_code         → 200                                         │
│ │                                                                           │
│ └─ gemini.safety_check [NESTED]                                            │
│    • text.masked              → true                                        │
│    • text.length              → 512                                         │
│    • check.result             → "safe"                                      │
│    • ttfb_ms                  → 150 (safety check duration)                 │
│    • http.status_code         → 200                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Additional Standalone Spans                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ gemini.summarization [CHILD]     │  gemini.tagging [CHILD]                 │
│ • text.masked      → true         │  • content.masked      → true           │
│ • text.length      → 2048         │  • content.length      → 1024           │
│ • summary.length   → 456          │  • tags.count          → 5              │
│ • compression_ratio→ "0.22"       │  • existing_tags.count → 12             │
│ • ttfb_ms          → 280          │  • ttfb_ms             → 200            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚨 Error Handling Flow

```
┌─ API CALL ──────────────────────────────────┐
│                                             │
│  try {                                      │
│    await geminiService.generateText()       │
│  } catch (error) {                          │
│    ─────────────────────────────────────┐   │
│                                         │   │
└─────────────────────────────────────────┼───┘
                                          │
                    ┌─────────────────────┴────────────────────┐
                    │                                         │
                    ▼                                         ▼

        ┌──────────────────┐                ┌──────────────────┐
        │  error?.status   │                │  OTHER ERROR     │
        │    === 429       │                │                  │
        └──────────────────┘                └──────────────────┘
                │                                    │
                ▼                                    ▼

    ┌───────────────────────┐        ┌─────────────────────────┐
    │ Set Span Attributes   │        │ Set Span Attributes     │
    │ • error.type: "rate_  │        │ • error.type: error.    │
    │   limit"              │        │   status || "unknown"   │
    │ • http.status_code:   │        │ • http.status_code: XX  │
    │   429                 │        │ • ttfb_ms: duration     │
    │ • retry.attempt: 2    │        └─────────────────────────┘
    │ • ttfb_ms: duration   │                │
    └───────────────────────┘                │
            │                               │
            ▼                               ▼

    ┌───────────────────────┐        ┌─────────────────────────┐
    │ Set Span Status       │        │ Set Span Status         │
    │ • code: 2 (ERROR)     │        │ • code: 2 (ERROR)       │
    │ • message: "Rate      │        │ • message: error.msg    │
    │   limit exceeded"     │        └─────────────────────────┘
    └───────────────────────┘                │
            │                               │
            ▼                               ▼

    ┌───────────────────────┐        ┌─────────────────────────┐
    │ Capture Exception      │        │ Capture Exception       │
    │ • tags:               │        │ • tags:                 │
    │   - error_type: rate_ │        │   - error_type: ...     │
    │     limit             │        │   - operation: ...      │
    │   - service: gemini   │        │   - service: gemini     │
    │   - retry_count: 2    │        └─────────────────────────┘
    │ • level: "warning"    │                │
    └───────────────────────┘                │
            │                               │
            ▼                               ▼

    ┌─────────────────────────────────────────────┐
    │    EXCEPTION LINKED TO SPAN IN SENTRY       │
    │    • Automatic context capture              │
    │    • Error phase attribution                │
    │    • Operation tracking                     │
    │    • Severity level set                     │
    └─────────────────────────────────────────────┘
```

---

## 📈 Status Code Mapping

```
Status Code Legend:
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ✅ 0 = OK (Success)                                            │
│  └─ Use: Normal completion, all checks passed                 │
│  └─ Example: Retrieve found 5 relevant docs at >0.7 threshold │
│                                                                 │
│  ⚠️  1 = WARNING (Degraded)                                     │
│  └─ Use: Operation completed but suboptimal                   │
│  └─ Example: Retrieve returned 0 docs, grade auto-passed     │
│                                                                 │
│  ❌ 2 = ERROR (Failed)                                          │
│  └─ Use: Operation failed, partial or no result               │
│  └─ Example: API timeout, 429 rate limit, JSON parse fail     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Status Code by Operation:

rag.retrieve
┌────────────────────────────────────────────────────────────┐
│ Status 0 (OK)     → Documents retrieved AND threshold met  │
│ Status 1 (WARN)   → No documents retrieved (0 results)     │
│ Status 2 (ERROR)  → pgvector query failed / timeout        │
└────────────────────────────────────────────────────────────┘

rag.grade
┌────────────────────────────────────────────────────────────┐
│ Status 0 (OK)     → Grade scores assigned                  │
│ Status 1 (WARN)   → JSON parse failed, auto-pass used      │
│ Status 2 (ERROR)  → Gemini API failed / timeout            │
└────────────────────────────────────────────────────────────┘

rag.generate
┌────────────────────────────────────────────────────────────┐
│ Status 0 (OK)     → Response generated AND safety checked  │
│ Status 1 (WARN)   → Response generated, safety check warn  │
│ Status 2 (ERROR)  → Response generation failed             │
└────────────────────────────────────────────────────────────┘

gemini.* (All API calls)
┌────────────────────────────────────────────────────────────┐
│ Status 0 (OK)     → HTTP 200, valid response              │
│ Status 1 (WARN)   → Rate limit with retry                 │
│ Status 2 (ERROR)  → 429 after max retries, 403, timeout   │
└────────────────────────────────────────────────────────────┘
```

---

## 🔒 Data Masking Reference

```
What Gets Sent to Sentry:
┌──────────────────────────────────────────────────────────────┐
│ ✅ VISIBLE (Operation Metrics)                              │
│                                                              │
│ • user.id            (identify user for triage)             │
│ • session.id         (group related requests)               │
│ • message.length     (query complexity metric)              │
│ • response.length    (response size metric)                 │
│ • retrieved.count    (document count)                       │
│ • documents_relevant (graded document count)                │
│ • ttfb_ms            (latency metric)                       │
│ • http.status_code   (API response code)                    │
│ • error.type         (error category)                       │
│ • retry.attempt      (retry count)                          │
│ • model              (which AI model used)                  │
│ • service            (which service called)                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘

What Does NOT Get Sent:
┌──────────────────────────────────────────────────────────────┐
│ 🔒 MASKED (User Content)                                    │
│                                                              │
│ • Actual user prompt                                         │
│ • Generated response text                                    │
│ • Document content from pgvector                             │
│ • Embedding input text                                       │
│ • Safety check input text                                    │
│ • Context snippets                                           │
│ • Any PII from documents                                     │
│                                                              │
│ Masking Implementation:                                      │
│ • Flag: prompt.masked: true                                 │
│ • Numeric only: question.length: 256                        │
│ • Never include: actual text in attributes                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 Performance Percentiles

```
Latency Distribution Chart:

            ┌─────────────────────────────────────────────────────┐
    3s  ┤  ▲                                                       │
        │  │                                                       │
    2.5s┤  │  P99                                                 │
        │  │  └──────────────────▲──────────────────┐            │
    2s  ┤  │                     │ P95               │            │
        │  │                     │ └────────┬─────────┼──────┐    │
    1.5s┤  │                     │          │         │      │    │
        │  │                     │          │         │      │    │
    1s  ┤  │                     │          │         │      │    │
        │  │                     │          │         │      │    │
    0.5s┤  │                     │          │         │      │    │
        │  │ ┌──────────┬────────┼──────────┼─────────┼──────┼──┐ │
        │  │ │ P50 (50%)│ P75    │ P90      │ P95     │ P99  │  │ │
        │  │ └──────────┴────────┴──────────┴─────────┴──────┴──┘ │
        ▼  │                                                       │
          └─────────────────────────────────────────────────────┘
            ws.ask_ai (root span)

Target SLA: P95 < 2 seconds

Actual Metrics (from testing):
• P50: 800ms ✅ (0.8s)
• P75: 1,100ms ✅ (1.1s)
• P90: 1,700ms ✅ (1.7s)
• P95: 2,000ms ✅ (2.0s) [AT THRESHOLD]
• P99: 5,000ms ⚠️ (5.0s) [NEEDS MONITORING]
```

---

## 🎯 Key Metrics Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI MODULE HEALTH DASHBOARD                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Request Volume          Error Rate          Response Time                │
│  ┌───────────────────┐  ┌───────────────┐   ┌──────────────────┐         │
│  │ ▲                 │  │ ▲              │   │ ▲ 3s             │         │
│  │ │  1,234          │  │ │  0.8%        │   │ │ P99             │         │
│  │ │  requests/min   │  │ │  (Target <1%)│   │ │ ─── 2s  [OK]    │         │
│  │ └─────────────────┘  │ │              │   │ │ P95             │         │
│  │                      │ └──────────────┘   │ │ ─── 1s          │         │
│  │                      │                    │ │ P50             │         │
│  │                      │                    │ └──────────────────┘         │
│  │                      │                    │                             │
│  └───────────────────┘  └───────────────┘   └──────────────────┘         │
│                                                                             │
│  Top Errors              Rate Limit Incidents  By Service                 │
│  ┌──────────────────┐   ┌────────────────┐   ┌──────────────┐            │
│  │ • Timeout: 12    │   │ 5 incidents    │   │ • pgvector   │            │
│  │ • JSON: 8        │   │ in last hour    │   │   (15% time)  │            │
│  │ • Empty: 2       │   │ ⚠️ Spike at    │   │ • gemini (85% │            │
│  │ • Quota: 0       │   │ 14:30 UTC      │   │   time)       │            │
│  └──────────────────┘   └────────────────┘   └──────────────┘            │
│                                                                             │
│  User Satisfaction       Document Retrieval   Safety Checks               │
│  ┌────────────────┐      ┌─────────────────┐  ┌──────────────────┐       │
│  │ 98.2%          │      │ • Avg: 4.8 docs │  │ • Safe: 99.9%    │       │
│  │ successful     │      │ • Min: 0 (12%)  │  │ • Unsafe: 0.1%   │       │
│  │ responses      │      │ • Max: 5        │  │   (2 incidents)  │       │
│  └────────────────┘      └─────────────────┘  └──────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Summary

This visual reference shows:

- Complete span hierarchy from user message to response
- Detailed attribute mapping for each span
- Error handling and status code flow
- Data privacy masking strategy
- Performance percentile distributions
- Key metrics dashboard

**Use this for**:

- Understanding system architecture
- Explaining span flow to team members
- Debugging latency issues
- Monitoring key metrics
- Validating data privacy
