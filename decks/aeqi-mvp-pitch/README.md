# aeqi MVP pitch deck

HTML/CSS source of truth for the Google Slides investor deck.

Render PNGs:

```sh
node decks/aeqi-mvp-pitch/render.mjs
```

Sync rendered PNGs into the live Google Slides deck after the branch is pushed
to GitHub:

```sh
node decks/aeqi-mvp-pitch/sync-google-slides.mjs \
  --base-url https://raw.githubusercontent.com/aeqi-ai/aeqi/ch-131-html-pitch-deck/apps/ui/public/decks/aeqi-mvp-pitch
```

The sync script replaces each slide's contents with one full-slide image. Keep
the HTML deck as the editable source.
