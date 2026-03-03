# Tech Stack: Panel Search

## Overview
Panel Search is built as a native GNOME Shell extension using the GNOME JavaScript (GJS) ecosystem. It targets the latest GNOME Shell versions to provide a modern search experience that integrates directly with system APIs.

## Core Stack
- **Programming Language:** JavaScript (SpiderMonkey / GJS)
- **Framework:** GNOME Shell Extension
- **Platform Versions:** GNOME Shell 48, 49, 50

## Libraries & APIs
- **GLib:** Core utility functions and system interaction.
- **GObject:** Object-oriented programming model for the GNOME platform.
- **Gio:** High-level I/O library for file system access (including FileEnumerator for scanning) and settings management.
- **St (Shell Toolkit):** UI toolkit for creating GNOME Shell components (e.g., the search widget).
- **Clutter:** Animation and layout engine used within the shell.
- **Shell API:** Direct access to GNOME Shell's search providers and window management.

## UI & Styling
- **CSS:** GNOME Shell-specific stylesheet for custom UI elements.
- **Libadwaita:** Standard for GNOME HIG compliance and modern widget aesthetics.

## Tools & Configuration
- **GNOME Extensions:** Used for extension metadata and preference management.
- **GSschemas:** For storing and managing extension-specific settings.
