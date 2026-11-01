All intervals are milliseconds from request start; parent and child durations overlap and must not be added.

| Span | Parent | Interval | Duration | Result |
|---|---|---:|---:|---|
| Checkout | — | 0–620 | 620 | HTTP 503 |
| Inventory lookup | Checkout | 8–32 | 24 | Success |
| Payment | Checkout | 40–580 | 540 | Error |
| First attempt | Payment | 45–165 | 120 | HTTP 429 |
| Retry delay | Payment | 165–365 | 200 | Wait |
| Second attempt | Payment | 365–545 | 180 | HTTP 429 |
| Response formatting | Checkout | 580–600 | 20 | Success |

**Dominant serial path:** payment entry → first attempt → retry delay → second attempt → payment exit → response formatting → checkout exit. Inventory finishes before payment starts; it is not the dominant bottleneck.

Payment children account for **500 ms**: 120 + 200 + 180. The remaining **40 ms** is 5 ms before the first attempt and 35 ms after the second. Outside payment there are 80 ms: inventory 24, formatting 20, and 36 not covered by the supplied child spans. Those gaps are unaccounted time, not proven CPU work or a known cause.