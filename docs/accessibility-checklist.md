# Accessibility release checklist

Automated Axe, keyboard, and reflow tests are release gates, but they do not replace assistive-technology review.

Before a production release, complete these manual checks on at least one desktop and one mobile-class browser viewport on the supported Linux/web release stack:

- **NVDA + Chrome/Firefox:** navigate sign-in, main navigation, student register, settings dialogs, validation errors, and print actions using headings, landmarks, form controls, tables, and live regions.
- **VoiceOver + Safari:** repeat the same critical paths and verify focus order, labels, dialog announcements, and status/error messages.
- **Keyboard only:** complete sign-in, record search/edit, modal open/close, destructive confirmation, and export actions without a pointer. Focus must remain visible and never become trapped.
- **200% zoom:** at a 640 CSS-pixel viewport, verify content reflows without document-level horizontal scrolling or obscured controls.
- **400% zoom:** at a 320 CSS-pixel viewport, verify the same reflow rule and that critical actions remain reachable.
- Verify that RTL reading order is logical, Persian labels are announced correctly, and decorative logos/images are not announced as content.

Record browser/AT versions and any exception in the release evidence. An unresolved blocker in a critical workflow prevents release.
