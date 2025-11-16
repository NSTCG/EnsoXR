/**
 * /!\ This file is auto-generated.
 *
 * This is the entry point of your standalone application.
 *
 * There are multiple tags used by the editor to inject code automatically:
 *     - `wle:auto-imports:start` and `wle:auto-imports:end`: The list of import statements
 *     - `wle:auto-register:start` and `wle:auto-register:end`: The list of component to register
 */

/* wle:auto-imports:start */
import {AudioListener} from '@wonderlandengine/components';
import {Cursor} from '@wonderlandengine/components';
import {CursorTarget} from '@wonderlandengine/components';
import {FingerCursor} from '@wonderlandengine/components';
import {HandTracking} from '@wonderlandengine/components';
import {InputProfile} from '@wonderlandengine/components';
import {MouseLookComponent} from '@wonderlandengine/components';
import {PlayerHeight} from '@wonderlandengine/components';
import {TeleportComponent} from '@wonderlandengine/components';
import {VrModeActiveSwitch} from '@wonderlandengine/components';
import {WasdControlsComponent} from '@wonderlandengine/components';
import {GrabComponent} from './Grab.js';
import {MeshBrush} from './MeshBrush.js';
import {MeshPaintable} from './MeshPaintable.js';
import {CinematicIntro} from './UI.js';
import {AlphaSliderCanvas} from './alpha-slider.js';
import {ButtonComponent} from './button.js';
import {CanvasAIChat} from './chat-ui.js';
/* wle:auto-imports:end */

export default function(engine) {
/* wle:auto-register:start */
engine.registerComponent(AudioListener);
engine.registerComponent(Cursor);
engine.registerComponent(CursorTarget);
engine.registerComponent(FingerCursor);
engine.registerComponent(HandTracking);
engine.registerComponent(InputProfile);
engine.registerComponent(MouseLookComponent);
engine.registerComponent(PlayerHeight);
engine.registerComponent(TeleportComponent);
engine.registerComponent(VrModeActiveSwitch);
engine.registerComponent(WasdControlsComponent);
engine.registerComponent(GrabComponent);
engine.registerComponent(MeshBrush);
engine.registerComponent(MeshPaintable);
engine.registerComponent(CinematicIntro);
engine.registerComponent(AlphaSliderCanvas);
engine.registerComponent(ButtonComponent);
engine.registerComponent(CanvasAIChat);
/* wle:auto-register:end */
}
