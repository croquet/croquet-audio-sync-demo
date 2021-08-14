
# Croquet synced audio demo

Copyright (C) 2021 Croquet Corporation

This repository contains a demonstration of a Croquet-based app for synchronised playback of an mp4 video with a corresponding mp3 audio file

# Installation

Clone this repository, then in the top directory run

    npm install

then, to build the app,

    npm run build

This will place all necessary files in the `dist/` directory.  During development we normally run the code by serving files through `ngrok` - for example, in `dist/`:

    ngrok http file:`pwd`

then point a browser to https://(@yourngroksubdomain).ngrok.io/conductor.html (note that it must be https)

The loaded URL will automatically be given a `q=...` property, identifying a (unique, new) shared session.  Mouse over the tiny QR code in the bottom left.  If you click the expanded version, an audience member for the same session will be opened in a new tab.  Or you can scan it with a mobile device to become an audience member there.

Only the original ("conductor") view responds to clicks by playing/pausing the sample video.  It also lets you scrub the video position in the progress bar at top.

Only the audience views will play any sound - and they might need a user gesture to enable the sound to start running.

# Dependencies

- icons, all from [the Noun Project](https://thenounproject.com/): Sound, by Markus; play, by Adrien Coquet
