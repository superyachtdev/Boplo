# Boplo Landing visual QA

## Comparison target

- Source visual truth: the user-provided Travelnk reference captures, especially `/var/folders/qd/39j4tv8n3lz_z4jtnsjftqxw0000gn/T/TemporaryItems/NSIRD_screencaptureui_W0AcXy/Screenshot 2026-10-20 at 14.44.37.png`, plus the live reference at `https://travelnk.com/` captured in browser tab 78.
- Implementation: browser-rendered local page at `http://127.0.0.1:8788/`, captured in browser tab 80 at 1280 × 720 CSS pixels, density 1.
- Mobile implementation: the same local URL, captured in browser tab 81 at 390 × 844 CSS pixels, density 1.
- State: default “I’m planning a move” hero, then the alternate “I’ve just arrived” state was also exercised.

## Full-view comparison evidence

The final implementation preserves the reference’s important visual principles: a very sparse centred hero, floating black pill navigation, restrained radial atmosphere, one crisp blue accent and generous empty space. It deliberately changes the peach travel palette to Boplo’s established electric-blue identity and replaces Travelnk’s App Store treatment with Boplo’s move-plan CTA.

The product presentation is implementation-specific: a mobile move-plan preview and a desktop decision view replace generic city photography. This is intentional and matches the revised direction to make the product, rather than AI-generated travel imagery, the visual proof.

## Focused review

- **Fonts and typography:** Manrope and DM Mono are loaded in the existing page head. Display type has a large, tight, editorial hierarchy; utility labels remain optically small and readable. Mobile line breaks were verified at 390px.
- **Spacing and layout rhythm:** The 1280px hero holds a centred type block with a large uninterrupted margin around it. At 390px, the nav collapses to the wordmark and CTA, the switch stays tappable, and the metric strip remains inside the viewport.
- **Colors and visual tokens:** The implementation uses black, navy, white and two Boplo blues only. The blue is limited to the active switch, CTA, italic display phrase and product cues.
- **Image quality and asset fidelity:** The old supplied blue Boplo wordmark is used directly. No AI imagery is present in the final route. Product previews are live semantic interface components, not placeholder screenshots.
- **Copy and content:** The hero, product preview, three-step explanation, city context, FAQ and £8.99 one-off plan message all align with the saved Boplo Landing brief.

## Comparison history

1. **P1 — photography made the experience feel like a generic travel campaign.**
   - Earlier implementation: browser tab 77 at 1280 × 720 used a blue-hour arrival photograph as the hero.
   - Fix: replaced the photo-led page with `landing-v3.js` / `landing-v3.css`: a minimal radial hero and designed Boplo product previews, matching the product-first reference structure.
2. **P1 — original wordmark was visually cropped in the floating nav.**
   - Earlier implementation: tab 79 showed the mark clipped after “bopl”.
   - Fix: increased the cropped source asset frame in `landing-v3-override.css` and recaptured in tab 80.
   - Post-fix evidence: the complete blue Boplo wordmark and star are visible at desktop and 390px mobile widths.
3. **P1 — the first product preview read as a static landing-page mock rather than a usable mobile product.**
   - Earlier implementation: the phone held one fixed budget card and the explanatory rows were dimmed, so the second and third states looked unavailable.
   - Fix: rebuilt the preview as a compact, interactive Plan / Money / Areas product flow. The three explanatory controls and the in-phone tabs stay readable, select the related state, and the in-phone “Open shortlist” action moves directly to the Areas view.
   - Post-fix evidence: local browser tab 83 verified the Money state at desktop and the Plan state at 390 × 844. All three tabs expose their correct selected state to assistive technology.
4. **P1 — the landing transition had too much vertical tension around the hero metrics and product heading.**
   - Fix: moved the metrics inside the hero, tightened the following section’s top rhythm, reduced the maximum hero display size, and made the floating nav persist while the product section is in view.

## Interactions checked

- The “I’m planning a move” / “I’ve just arrived” switch updates hero copy and active state.
- The main CTA opens the early-access dialog.
- Navigation anchors are present, and FAQ disclosures use native `details` controls.
- The product preview’s Plan, Money and Areas tabs, the three explanation rows, and the in-phone shortlist action update the visible screen and active state.

## Final result

passed
