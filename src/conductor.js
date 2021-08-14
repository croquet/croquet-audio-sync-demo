/*
   Copyright 2021 Croquet Corporation

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
import 'pepjs';
import sampleVideo from "../assets/sampleVideo.mp4";
import sampleAudio from "../assets/sampleAudio.mp3";

const { View, Session, App } = Croquet;

const SCRUB_THROTTLE = 1000 / 10; // min time between scrub events

// a throttle that also ensures that the last value is delivered
function throttle(fn, delay) {
    let lastTime = 0;
    let timeoutForFinal = null;
    const clearFinal = () => {
        if (timeoutForFinal) {
            clearTimeout(timeoutForFinal);
            timeoutForFinal = null;
        }
    };
    const runFn = arg => {
        clearFinal(); // shouldn't be one, but...
        lastTime = Date.now();
        fn(arg);
    };
    return arg => {
        clearFinal();
        const toWait = delay - (Date.now() - lastTime);
        if (toWait < 0) runFn(arg);
        else timeoutForFinal = setTimeout(() => runFn(arg), toWait);
    };
}

class TimeBarView {
    constructor() {
        this.element = document.getElementById('timebar');
        window.addEventListener('resize', () => this.onWindowResize(), false);
        this.onWindowResize();

        this.rootView = null;
        this.lastDragProportion = null;
        this.lastDrawnProportion = null;

        const container = document.getElementById('container');
        container.addEventListener('pointerup', evt => this.onContainerClick(evt)); // pointerdown doesn't seem to satisfy the conditions for immediately activating a video, at least on Android

        const element = this.element;
        element.addEventListener('pointerdown', evt => this.onPointerDown(evt));
        element.addEventListener('pointermove', throttle(evt => this.onPointerMove(evt), SCRUB_THROTTLE));
        element.addEventListener('pointerup', evt => this.onPointerUp(evt));
    }

    setView(view) {
        this.rootView = view;
        this.drawPlaybar(0);
    }

    onPointerDown(evt) {
        evt.stopPropagation();
        if (!this.rootView) return;

        this.dragging = true;
        this.dragAtOffset(evt.offsetX);
        evt.preventDefault();
    }

    onPointerUp(evt) {
        evt.stopPropagation();
        if (!this.rootView) return;

        this.dragging = false;
        evt.preventDefault();
    }

    // already throttled
    onPointerMove(evt) {
        if (!this.rootView) return;
        if (!this.dragging) return;

        this.dragAtOffset(evt.offsetX);
        evt.preventDefault();
    }

    dragAtOffset(offsetX) {
        const barWidth = this.element.width;
        const timeProportion = Math.max(0, Math.min(1, offsetX / barWidth));
        if (this.lastDragProportion === timeProportion) return;

        this.lastDragProportion = timeProportion;
        this.rootView.handleTimebar(timeProportion);
    }

    onWindowResize() {
        const canvas = this.element;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        // clear saved portion to force redraw
        const portion = this.lastDrawnProportion;
        this.lastDrawnProportion = null;
        this.drawPlaybar(portion);
    }

    onContainerClick(evt) {
        if (!this.rootView) return;

        this.rootView.handleUserClick(evt);
        evt.preventDefault();
    }

    drawPlaybar(portion) {
        if (this.lastDrawnProportion === portion) return;

        this.lastDrawnProportion = portion;

        const canvas = this.element;
        const ctx = canvas.getContext('2d');
        /* eslint-disable-next-line no-self-assign */
        canvas.width = canvas.width;
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(0, 0, canvas.width * portion, canvas.height);
    }
}
// VideoView is an interface over an HTML video element.
// its readyPromise resolves once the video is available to play.
export class VideoView {
    constructor(url) {
        this.url = url;
        this.video = document.createElement("video");
        this.video.autoplay = false;
        this.video.loop = true;
        this.video.muted = true;
        this.isPlaying = false;
        this.isBlocked = false; // unless we find out to the contrary, on trying to play
        this.readyPromise = new Promise(resolved => {
            this._ready = () => resolved(this);
        });

        this.video.oncanplay = () => {
            this.duration = this.video.duration; // ondurationchange is (apparently) always ahead of oncanplay
            this._ready();
        };

        this.video.onerror = () => {
            let err;
            const errCode = this.video.error.code;
            switch (errCode) {
                case 1: err = "video loading aborted"; break;
                case 2: err = "network loading error"; break;
                case 3: err = "video decoding failed / corrupted data or unsupported codec"; break;
                case 4: err = "video not supported"; break;
                default: err = "unknown video error";
            }
            console.log(`Error: ${err} (errorcode=${errCode})`);
        };

        /* other events, that can help with debugging
        [ "pause", "play", "seeking", "seeked", "stalled", "waiting" ].forEach(k => { this.video[`on${k}`] = () => console.log(k); });
        */

        this.video.crossOrigin = "anonymous";

        if (!this.video.canPlayType("video/mp4").match(/maybe|probably/i)) {
            console.log("apparently can't play video");
        }

        this.video.src = this.url;
        this.video.load();
    }

    width() { return this.video.videoWidth; }
    height() { return this.video.videoHeight; }

    wrappedTime(videoTime, guarded) {
        if (this.duration) {
            while (videoTime > this.duration) videoTime -= this.duration; // assume it's looping, with no gap between plays
            if (guarded) videoTime = Math.min(this.duration - 0.1, videoTime); // the video element freaks out on being told to seek very close to the end
        }
        return videoTime;
    }

    async play(videoTime) {
        // return true if video play started successfully
        this.video.currentTime = this.wrappedTime(videoTime, true);
        this.isPlaying = true; // even if it turns out to be blocked by the browser
        // following guidelines from https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play
        try {
            await this.video.play(); // will throw exception if blocked
            this.isBlocked = false;
        } catch (err) {
            console.warn("video play blocked");
            this.isBlocked = this.isPlaying; // just in case isPlaying was set false while we were trying
        }
        return !this.isBlocked;
    }

    pause(videoTime) {
        this.isPlaying = this.isBlocked = false; // might not be blocked next time.
        this.setStatic(videoTime);
    }

    setStatic(videoTime) {
        if (videoTime !== undefined) this.video.currentTime = this.wrappedTime(videoTime, true); // true => guarded from values too near the end
        this.video.pause(); // no return value; synchronous, instantaneous?
    }

    dispose() {
        try {
            URL.revokeObjectURL(this.url);
            if (this.texture) {
                this.texture.dispose();
                delete this.texture;
            }
            delete this.video;
        } catch (e) { console.warn(`error in VideoView cleanup: ${e}`); }
    }
}

const timebarView = new TimeBarView(); // used by both conductor and audience, for now

class ConductorView extends View {
    constructor(model) {
        super(model);
        this.model = model;

        timebarView.setView(this);

        this.playIcon = document.getElementById('play');
        this.container = document.getElementById('container');

        this.subscribe('model', 'statusTick', this.statusTick);
        this.subscribe('model', { event: 'assets-changed', handling: 'oncePerFrameWhileSynced' }, this.assetsChanged);
        this.subscribe(this.viewId, { event: 'synced', handling: 'immediate' }, this.handleSyncState);

        this.videoView = null;

        if (!this.model.videoAsset) {
            this.publish('conductor', "set-assets", {
                audio: { fileUrl: sampleAudio, name: "sampleAudio" },
                video: { fileUrl: sampleVideo, name: "sampleVideo" }
                });
        } else this.assetsChanged();
    }

    async assetsChanged() {
        // our subscription is oncePerFrameWhileSynced, so in theory this can be
        // triggered in the midst of events updating other model properties.  but
        // those other properties will have been set after, and therefore be
        // compatible with, whatever videoAsset we find by examining the model
        // right now.
        View.displayStatus(`Fetching ${this.model.videoAsset.name}`);

        this.disposeOfVideo(); // discard any loaded or loading video

        this.waitingForSync = !this.realm.isSynced(); // @@ realm ok?  this can flip back and forth

        const { videoAsset, isPlaying, startOffset, pausedTime } = this.model;
        this.latestPlayState = { isPlaying, startOffset, pausedTime }; // could be overridden by subsequent local changes by the time the video is ready

        let okToGo = true; // unless cancelled by another load, or a shutdown
        this.abandonLoad = () => okToGo = false;

        try {
            const urlObj = await this.objectURLFor(videoAsset);
            const videoView = await (new VideoView(urlObj.url)).readyPromise;

            if (!okToGo) return; // been cancelled
            delete this.abandonLoad;

            this.videoView = videoView;
            const videoElem = this.videoElem = videoView.video;
            this.playbackBoost = 0;
            this.container.appendChild(videoElem);

            this.applyPlayState();
            this.lastTimingCheck = this.now() + 500; // let it settle before we try to adjust

        } catch (err) { console.error(err); }
    }

    statusTick() {
        this.announcePlaybackTiming();
    }

    adjustPlaybar() {
        const time = this.videoView.isPlaying ? this.videoView.video.currentTime : (this.latestPlayState.pausedTime || 0);
        timebarView.drawPlaybar(time / this.videoView.duration);
    }

    playStateChanged(state) {
        // invoked immediately when the local user interacts with the video
        // (play, pause, scrub).
        // publishes a set-play-state event to update the model, and hence all
        // audience views.

        const latest = this.latestPlayState;
        // ignore if we've heard this one before (probably because we set it locally)
        if (latest && Object.keys(state).every(key => state[key] === latest[key])) return;

        this.publish('conductor', 'set-play-state', {...state}); // subscribed to by the shared model
        this.latestPlayState = state;
        this.applyPlayState(); // will be ignored if we're still initialising
    }

    applyPlayState() {
        if (!this.videoView || this.waitingForSync) return;

        this.adjustPlaybar();

        const { videoView, videoElem } = this;

        //console.log("apply playState", {...this.latestPlayState});
        if (!this.latestPlayState.isPlaying) {
            this.iconVisible('play', true);
            videoView.pause(this.latestPlayState.pausedTime);
        } else {
            this.iconVisible('play', false);
            videoElem.playbackRate = 1 + this.playbackBoost * 0.01;
            this.lastRateAdjust = this.now(); // make sure we don't adjust rate until playback has settled in, and after any emergency jump we decide to do
            videoView.play(this.calculateVideoTime() + 0.1).then(playStarted => {
                if (!playStarted) console.warn("video didn't start");
                });
        }
    }

    calculateVideoStartOffset() {
        const videoTime = this.videoView.video.currentTime;
        const sessionTime = this.extrapolatedNow(); // the session time corresponding to the video time
        return Math.round(sessionTime - 1000 * videoTime);
    }

    calculateVideoTime() {
        const { isPlaying: _isP, startOffset } = this.latestPlayState;
        // if (!isPlaying) debugger;

        const sessionNow = this.extrapolatedNow();
        return (sessionNow - startOffset) / 1000;
    }

    handleSyncState(isSynced) {
        //console.warn(`synced: ${isSynced}`);
        const wasWaiting = this.waitingForSync;
        this.waitingForSync = !isSynced;
        if (wasWaiting && isSynced) this.applyPlayState();
    }

    handleUserClick(_evt) {
        if (!this.videoView) return;

        const { videoView } = this;

        const wantsToPlay = !this.latestPlayState.isPlaying; // toggle
        if (!wantsToPlay) videoView.pause(); // immediately!
        const startOffset = wantsToPlay ? this.calculateVideoStartOffset() : null;
        const pausedTime = wantsToPlay ? 0 : Math.round(videoView.video.currentTime * 100) / 100;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime }); // directly from the handler, in case the browser blocks indirect play() invocations
    }

    handleTimebar(proportion) {
        if (!this.videoView) return;

        const wantsToPlay = false;
        const videoTime = this.videoView.duration * proportion;
        const startOffset = null;
        const pausedTime = videoTime;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime });
    }

    announcePlaybackTiming() {
        if (this.videoView) {
            const lastTimingCheck = this.lastTimingCheck || 0;
            const now = Date.now();
            // check and announce timing every 900ms while video is playing
            // (thus pre-empting the 1000ms ticks that the reflector would
            // otherwise send)
            if (this.videoView.isPlaying && !this.videoView.isBlocked && now - lastTimingCheck >= 900) {
                this.lastTimingCheck = now;

                this.adjustPlaybar();

                if (this.latestPlayState.isPlaying) {
                    const currentStartOffset = this.calculateVideoStartOffset();
                    this.latestPlayState.startOffset = currentStartOffset;
                    this.publish('conductor', 'set-start-offset', currentStartOffset);
                }
            }
        }
    }

    // invoked on every animation frame
    update() {
        this.announcePlaybackTiming();
    }

    detach() {
        super.detach(); // will discard any outstanding future() messages
        this.disposeOfVideo();
        timebarView.setView(null);
    }

    disposeOfVideo() {
        // abandon any in-progress load
        if (this.abandonLoad) {
            this.abandonLoad();
            delete this.abandonLoad;
        }

        // and dispose of any already-loaded element
        if (this.videoView) {
            this.videoView.pause();
            const elem = this.videoView.video;
            elem.parentNode.removeChild(elem);
            this.videoView.dispose();
            this.videoView = null;
        }
    }

    iconVisible(iconName, bool) {
        this[`${iconName}Icon`].style.opacity = bool ? 1 : 0;
    }

    async objectURLFor(asset) {
        const res = await fetch(asset.fileUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const revoke = () => { URL.revokeObjectURL(url); return null; }; // return null to support "urlObj.revoke() || result" usage
        return { url, revoke };
    }
}

async function go() {
    App.messages = true;
    App.makeWidgetDock();

    await Session.join({
        appId: "io.croquet.examples.audio_sync_demo",
        name: App.autoSession(),
        // password: App.autoPassword({keyless: true}),
        password: "dummy", // during testing we need to be able to see the messages
        model: window.SyncedAudioModel,
        view: ConductorView,
        tps: 1, // but conductor should be sending status every 900ms while playing
        autoSleep: false
    });

    App.sessionURL = window.location.href.replace('conductor.html', '');
    App.makeSessionWidgets();
}

go();
