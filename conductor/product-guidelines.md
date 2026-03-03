# Product Guidelines: Panel Search

## Prose & Communication
- **Tone:** Professional and Neutral. User-facing text should be clear, concise, and match the standard tone of GNOME Shell applications.
- **Clarity:** Ensure that all labels and messages (e.g., in preferences or the omnibox) are easily understandable for a general audience.
- **Action-Oriented:** Use active, direct verbs for buttons and settings.

## Design & Visual Language
- **Styling:** Full Native Adwaita. The extension must strictly adhere to GNOME's Adwaita styling and Human Interface Guidelines (HIG).
- **Consistency:** Use system-standard fonts, colors, and iconography to ensure the widget feels like a native component of the desktop.
- **Modernity:** Maintain a clean, uncluttered layout that minimizes visual noise.

## User Experience (UX) Principles
- **Immediate Response:** Performance is critical. Search results must appear instantly, with optimized debouncing for more complex queries (like web search).
- **Visual Selection Cues:** Use clear, high-contrast visual indicators to show which item is currently focused or selected.
- **Keyboard-First Design:** All search features and navigation must be fully accessible and efficient via keyboard alone (arrows, Enter, Esc).
- **Intuitive Navigation:** Follow common desktop search patterns to ensure a low learning curve for new users.

## Accessibility
- **Screen Reader Support:** Ensure that focus states and result descriptions are accessible to assistive technologies.
- **Contrast:** Maintain high contrast ratios for text and icons to ensure readability across different system themes.
- **Standard Shortcuts:** Use standard GNOME keyboard shortcuts for common actions (e.g., Esc to close).
