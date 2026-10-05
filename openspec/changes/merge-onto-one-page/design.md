## Decisions (from the UX / visual / feasibility review)

- **Preview before saving.** Detection can be wrong and merging removes the originals. `/merge/onepage` analyses once (pdftoppm one page at a time, so memory stays flat on the Pi), caches the lossless pages under a token for 30 min, and returns a 48 dpi preview, per-item crops/sizes and the scale. Tweaks re-compose from the cache (~0.1 s); `/merge` with `one_page: {token, items}` composes the same layout at full resolution.
- **Detection** (pure Pillow, tested on synthetic scans): background level = the page's most common grey (works on a grey lid); content = clearly darker or brighter than that, edges (white cards on white) and coloured pixels; 1 mm grid; edge bands that are mostly content (lid shadow, ≤15 mm) stripped; regions under 30 mm² or thinner than 8 mm (dust, hairs) and scraps under 3% of the largest dropped; union of the rest, padded by 5 mm. A white receipt on a white lid has no visible edge, so its crop is the printed area.
- **Several objects on one page** → one union crop (keeps two cards side by side; never splits a receipt with a gap).
- **Layout:** rows, merge order, rows centred, 10 mm page margins / 6 mm gaps; largest scale ≤ 1 that fits (binary search). The page is filled with the scans' own background colour so crops don't show as pale boxes.
- **Not in v1:** deskew, manual crop handles, splitting objects, rotation.
- Thresholds are from synthetic pages; calibrate on real DCP-1511 scans of receipts/cards.
