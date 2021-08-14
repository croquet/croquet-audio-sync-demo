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

const { Model } = Croquet;

// a shared model for handling audio loads and interactions
class SyncedAudioModel extends Model {
    init(options) {
        super.init(options);
        this.asset = null;
        this.handles = {};

        this.subscribe('conductor', 'set-assets', this.setAssets);
        this.subscribe('conductor', 'set-play-state', this.setPlayState);
        this.subscribe('conductor', 'set-start-offset', this.setStartOffset);

        this.subscribe('audience', 'report', this.handleReport);

        this.statusTick();
    }

    statusTick() {
        // in case the ConductorView isn't being animated, we generate a
        // tick that will nudge it once in every second of teatime
        this.publish('model', 'statusTick');
        this.future(1000).statusTick();
    }

    setAssets({ audio, video }) {
        this.isPlaying = false;
        this.startOffset = null; // only valid if playing
        this.pausedTime = 0; // only valid if paused

        this.audioAsset = audio;
        this.videoAsset = video;
        this.publish('model', 'assets-changed');
    }

    // the ConductorView sends 'set-play-state' events when the user plays, pauses or scrubs the video.
    setPlayState(data) {
        const { isPlaying, startOffset, pausedTime } = data;
        this.isPlaying = isPlaying;
        this.startOffset = startOffset;
        this.pausedTime = pausedTime;
        this.publish('model', 'play-state-changed', { isPlaying, startOffset, pausedTime });
    }

    setStartOffset(startOffset) {
        if (!this.isPlaying) return;

        this.startOffset = startOffset;
        this.publish('model', 'start-offset-changed', startOffset);
    }

    handleReport(report) {
        console.log(Object.keys(report).sort().map(k => `${k}:${report[k]}`).join(', '));
        this.publish(report.viewId, 'reportReceived');
    }
}
SyncedAudioModel.register("SyncedAudioModel");
window.SyncedAudioModel = SyncedAudioModel;
