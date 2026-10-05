## Why

Small items (receipts, an ID card, a parcel slip) are scanned one per A4 page, mostly empty. When merging them the user often wants them together on a single A4 sheet, the way they'd lay them on the glass if they fit.

## What Changes

- The Merge dialog gets a **Separate pages | One page** switch (remembered per browser; Separate pages stays the default and is unchanged).
- **One page** finds the item on every page of the selected scans, crops it, and lays the crops out on one A4 page in merge order: left to right, wrapping into rows, at real size when they fit, otherwise all scaled by the same factor.
- A **preview** of the composed page is shown before saving (real size / "scaled to N%"), with an ordered list where each item can be moved up/down, switched to its whole page, or left out. A page where nothing is found starts left out.
- The saved PDF is what the preview showed, at the scans' own resolution (≤300 dpi), grey when all inputs were grey, OCR'd with the scan pipeline's languages when it OCRs. Only scans actually used are removed; Undo restores them.

## Impact

- `roles/web-ui/files/scan-web.py`: detector, row layout, `/merge/onepage` preview with a cached analysis token, `one_page` in `/merge`.
- `web-ui-src`: `OnePageMerge` component, Merge dialog switch, `up`/`down`/`page` icons in `IconBtn`.
