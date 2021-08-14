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
import Bowser from "bowser";

const { View, Session, App } = Croquet;
const browserInfo = Bowser.parse(window.navigator.userAgent);

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

// AudioView is an interface over an HTML audio element.
// its readyPromise resolves once the audio is available to play.
export class AudioView {
    constructor(url) {
        this.url = url;
        this.audio = document.createElement('audio');
        this.audio.autoplay = false;
        this.audio.loop = true;
        this.isPlaying = false;
        this.isBlocked = false; // unless we find out to the contrary, on trying to play

        this.readyPromise = new Promise(resolved => {
            this._ready = () => resolved(this);
        });

        this.audio.oncanplay = () => {
            this.duration = this.audio.duration; // ondurationchange is (apparently) always ahead of oncanplay
            this._ready();
        };

        this.audio.onerror = () => {
            const error = this.audio.error;
            console.log(`Audio Error`, error);
        };

        this.audio.crossOrigin = "anonymous";

        if (!this.audio.canPlayType("audio/mpeg").match(/maybe|probably/i)) {
            console.log("apparently can't play audio");
        }

        this.audio.src = this.url;
        this.audio.load();
    }

    width() { return 1; }
    height() { return 1; }

    wrappedTime(audioTime, guarded) {
        if (this.duration) {
            while (audioTime > this.duration) audioTime -= this.duration; // assume it's looping, with no gap between plays
            if (guarded) audioTime = Math.min(this.duration - 0.1, audioTime); // a video element, at least, freaks out on being told to seek very close to the end.  maybe an audio element too.
        }
        return audioTime;
    }

    async play(audioTime) {
        // return true if audio play started successfully
        this.audio.currentTime = this.wrappedTime(audioTime, true);
        this.isPlaying = true; // even if it turns out to be blocked by the browser
        this.isBlocked = true; // so checkPlaybackTiming doesn't try to interfere
        this.audio.volume = 0.2; // until checkPlaybackTiming has run.  IGNORED ON MOBILE SAFARI!
        // following guidelines from https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play
        try {
            await this.audio.play(); // will throw exception if blocked
            this.isBlocked = false;
        } catch (err) {
            console.warn("audio play blocked");
        }
        return !this.isBlocked;
    }

    pause(audioTime) {
        this.isPlaying = this.isBlocked = false; // might not be blocked next time.
        this.setStatic(audioTime);
    }

    setStatic(audioTime) {
        if (audioTime !== undefined) this.audio.currentTime = this.wrappedTime(audioTime, true); // true => guarded from values too near the end
        this.audio.pause(); // no return value; synchronous, instantaneous?
    }

    dispose() {
        try {
            URL.revokeObjectURL(this.url);
            if (this.texture) {
                this.texture.dispose();
                delete this.texture;
            }
            delete this.audio;
        } catch (e) { console.warn(`error in AudioView cleanup: ${e}`); }
    }
}

const timebarView = new TimeBarView(); // used by both conductor and audience, for now

class SyncingAudioView extends View {
    constructor(model) {
        super(model);
        this.model = model;

// this.realm.island.controller.connection.send(JSON.stringify({ id: this.sessionId, action: 'PING', args: Date.now() }));

        timebarView.setView(this);

        this.enableSoundIcon = document.getElementById('soundon');
        this.playIcon = document.getElementById('play');
        this.container = document.getElementById('container');

        this.subscribe('model', { event: 'assets-changed', handling: 'oncePerFrameWhileSynced' }, this.assetsChanged);
        this.subscribe('model', 'play-state-changed', this.playStateChanged);
        this.subscribe('model', { event: 'start-offset-changed', handling: 'immediate' }, this.startOffsetChanged);
        this.subscribe(this.viewId, { event: 'synced', handling: 'immediate' }, this.handleSyncState);
        this.subscribe(this.viewId, { event: 'reportReceived', handling: 'immediate' }, this.reportReceived);

        this.audioView = null;
        this.smoothedDiff = null;

        // an answer by Jaakko Karhu on https://stackoverflow.com/questions/9811429/html5-audio-tag-on-safari-has-a-delay claims that simply the creation of an AudioContext removes some delays in Safari audio.  i'm not sure it doesn't.
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        if (this.model.audioAsset) this.assetsChanged();
window.mainView = this;
    }

    async assetsChanged() {
        View.displayStatus(`Fetching ${this.model.audioAsset.name}`);

        this.disposeOfAudio(); // discard any loaded or loading video

        this.waitingForSync = !this.realm.isSynced(); // this can flip back and forth

        const { audioAsset, isPlaying, startOffset, pausedTime } = this.model;
        this.latestPlayState = { isPlaying, startOffset, pausedTime };

        let okToGo = true; // unless cancelled by another load, or a shutdown
        this.abandonLoad = () => okToGo = false;

        try {
            const urlObj = await this.objectURLFor(audioAsset);
            const audioView = await (new AudioView(urlObj.url)).readyPromise;

            if (!okToGo) return; // been cancelled
            delete this.abandonLoad;

            this.audioView = audioView;
            const audioElem = this.audioElem = audioView.audio;
            this.playbackBoost = 0;
            this.container.appendChild(audioElem);

            this.applyPlayState();
            this.lastTimingCheck = Date.now() + 500; // let it settle before we try to adjust

        } catch (err) { console.error(err); }
    }

    adjustPlaybar() {
        const time = this.latestPlayState.isPlaying && !this.audioView.isBlocked ? this.audioView.audio.currentTime : (this.latestPlayState.pausedTime || 0);
        timebarView.drawPlaybar(time / this.audioView.duration);
    }

    playStateChanged(rawData) {
        const data = { ...rawData }; // take a copy that we can play with

        const latest = this.latestPlayState;
        // ignore if we've heard this one before
        if (latest && Object.keys(data).every(key => data[key] === latest[key])) return;

        this.latestPlayState = data;
        this.applyPlayState(); // will be ignored if we're still initialising
    }

    startOffsetChanged(startOffset) {
        const { isPlaying } = this.latestPlayState;
        if (isPlaying) {
            this.latestPlayState.startOffset = startOffset;
            this.checkPlaybackTiming();
        }
    }

    applyPlayState() {
        if (!this.audioView || this.waitingForSync) return;

        const { audioView, audioElem } = this;

        if (!this.latestPlayState.isPlaying) {
            this.iconVisible('play', true);
            this.iconVisible('enableSound', false);
            audioView.pause(this.latestPlayState.pausedTime);
        } else {
            delete this.lastJump; // ok to jump on next check
            delete this.lastRateAdjust; // ok to adjust rate on next check
            this.smoothedDiff = null; // no history
            this.iconVisible('play', false);
            audioElem.playbackRate = 1 + this.playbackBoost * 0.01;
            this.lastRateAdjust = Date.now(); // make sure we don't adjust rate until playback has settled in, and after any emergency jump we decide to do
            this.jumpIfNeeded = false;
const randomizeStart = false; // $$$ set true for testing
const randomOffset = randomizeStart ? Math.random() : 0; // seconds
            audioView.play(this.calculateAudioTime() + 0.1 + randomOffset).then(playStarted => {
                this.iconVisible('enableSound', !playStarted);
                });
        }

        this.adjustPlaybar();
    }

    calculateAudioTime() {
        // given the estimate of our current time in the session, and the start offset
        // for the video (and hence audio) track, estimate where we should be
        // in the audio.
        const { isPlaying: _isP, startOffset } = this.latestPlayState;

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
        const audioView = this.audioView;
        if (audioView && audioView.isBlocked && audioView.isPlaying) {
this.publish('audience', 'report', {report: "trying to unblock", viewId: this.viewId });
            this.applyPlayState();
        }
    }

    checkPlaybackTiming() {
        if (this.audioView) {
            const now = Date.now();
            if (this.audioView.isPlaying && !this.audioView.isBlocked) {
                const expectedTime = this.audioView.wrappedTime(this.calculateAudioTime());
                const audioTime = this.audioView.audio.currentTime;
                const audioDiff = audioTime - expectedTime;

const report = { viewId: this.viewId, expectedTime, teatime: this.now(), audioTime: Math.round(audioTime * 1000) / 1000, playback: this.audioView.audio.playbackRate, volume: this.audioView.audio.volume };
report.platform = `${browserInfo.platform.type} ${browserInfo.os.name} ${browserInfo.os.version} ${browserInfo.browser.name} ${browserInfo.browser.version}`;
if (this.reportLatency) report.latency = this.reportLatency;
const sessionOffset = now - this.extrapolatedNow();
if (this.sessionOffset) {
    // report how much our estimate of the session's time origin has changed since the last loop
    const sessionVariation = sessionOffset - this.sessionOffset;
    report.sessionVariation = sessionVariation;
}
this.sessionOffset = sessionOffset;

                    if (Math.abs(audioDiff) < this.audioView.duration / 2) { // otherwise presumably measured across a loop restart; just ignore.
                    const audioDiffMS = audioDiff * 1000; // +ve means *ahead* of where it should be
                    let audioDiffMSSmoothed = Math.round(audioDiffMS);
                    if (this.smoothedDiff === null) this.smoothedDiff = audioDiffMSSmoothed;
                    else {
                        const newFactor = 0.3;
                        audioDiffMSSmoothed = this.smoothedDiff = Math.round(newFactor * audioDiffMS + (1 - newFactor) * this.smoothedDiff);
                    }
report.audioDiffMS = Math.round(audioDiffMS);
report.audioDiffMSSmoothed = audioDiffMSSmoothed;

                    // if there's a difference greater than 500ms, try to jump the
                    // audio to the right place.  but don't allow more than one jump
                    // in 10s.  tweaking the playback rate is supposed to do the job.
                    const wantToJump = Math.abs(audioDiffMSSmoothed) > 500;
                    if (wantToJump && (now - (this.lastJump || 0) > 10000)) {
                        this.lastJump = now;
report.jumped = -Math.round(audioDiffMSSmoothed);
                        console.log(`jumping audio by ${-Math.round(audioDiffMSSmoothed)}ms`);
                        this.smoothedDiff = null;
                        const lostTime = 0.2; // empirically, it seems that doing a jump introduces about this much delay
                        this.audioView.audio.currentTime = this.audioView.wrappedTime(audioTime - audioDiffMSSmoothed/1000 + lostTime, true); // true to ensure we're not jumping to a point too close to the end
                    } else {
                        // every 3s, check audio lag/advance, and set the playback rate accordingly.
                        // current adjustment settings:
                        //   > 300ms off: set playback 5% faster/slower than normal
                        //   > 150ms off: 3%
                        //   > 50ms: 1%
                        //   < 25ms: normal (i.e., hysteresis between 50ms and 25ms in the same sense)
                        const CHECK_INTERVAL = 3000;
                        const THRESH_5 = 300;
                        const THRESH_3 = 150;
                        const THRESH_1 = 50;
                        const THRESH_0 = 25;
                        if (now - (this.lastRateAdjust || 0) >= CHECK_INTERVAL) {
                            const oldBoostPercent = this.playbackBoost;
report.oldBoost = oldBoostPercent;
                            const diffAbs = Math.abs(audioDiffMSSmoothed), diffSign = Math.sign(audioDiffMSSmoothed);
                            const desiredBoostPercent = -diffSign * (
                                diffAbs > THRESH_5 ? 5 :
                                diffAbs > THRESH_3 ? 3 :
                                diffAbs > THRESH_1 ? 1 : 0);
                            if (desiredBoostPercent !== oldBoostPercent) {
                                // apply hysteresis on the switch to boost=0.
                                // for example, if old boost was +ve (because audio was lagging),
                                // and audioDiff is -ve (i.e., it's still lagging),
                                // and the magnitude (of the lag) is greater than 25ms,
                                // don't remove the boost yet.
                                const hysteresisBlock = desiredBoostPercent === 0 && Math.sign(oldBoostPercent) === -diffSign && diffAbs >= THRESH_0;
                                if (!hysteresisBlock) {
report.newBoost = desiredBoostPercent;
                                    this.playbackBoost = desiredBoostPercent;
                                    const playbackRate = 1 + this.playbackBoost * 0.01;
                                    console.log(`audio playback rate: ${playbackRate}`);
                                    this.audioView.audio.playbackRate = playbackRate;
                                }
                            }
                            this.lastRateAdjust = now;
                        }
                    }
                }

                // on browsers that support it (i.e., at least not mobile Safari)
                // we set volume low on starting to play.  now that we've had a
                // chance to adjust/jump, set it back to normal.
                this.audioView.audio.volume = 1.0;

                // when a video loops back to the start, browsers often introduce
                // a big but random delay.  if a loop is about to happen, clear
                // any jump record so we can jump immediately if needed.
                if (this.audioView.duration - audioTime < 1.5) delete this.lastJump;

this.reportSendTime = Date.now(); // for latency calculation
this.publish('audience', 'report', report);
            }
        this.adjustPlaybar();
        }
    }

    detach() {
        super.detach(); // will discard any outstanding future() messages
        this.disposeOfAudio();
        timebarView.setView(null);
    }

    disposeOfAudio() {
        // abandon any in-progress load
        if (this.abandonLoad) {
            this.abandonLoad();
            delete this.abandonLoad;
        }

        // and dispose of any already-loaded element
        if (this.audioView) {
            this.audioView.pause();
            const elem = this.audioView.audio;
            elem.parentNode.removeChild(elem);
            this.audioView.dispose();
            this.audioView = null;
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

    reportReceived() {
        this.reportLatency = Date.now() - this.reportSendTime;
    }
}

async function go() {
    App.messages = true;
    App.makeWidgetDock();

    Session.join({
        appId: "io.croquet.examples.audio_sync_demo",
        name: App.autoSession(),
        // password: App.autoPassword({keyless: true}),
        password: "dummy", // during testing we need to be able to see the messages
        model: window.SyncedAudioModel,
        view: SyncingAudioView,
        viewOnly: false, // $$$ during testing
        tps: 1, // but conductor should be sending status every 900ms while playing
        autoSleep: false
    });
}

go();
