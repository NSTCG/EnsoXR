import {EditorPlugin, ui} from '@wonderlandengine/editor-api';

/* This is an example of a Wonderland Editor plugin */
export default class CustomPlugin extends EditorPlugin {

    /* The constructor is called when your plugin is loaded */
    constructor() {
        super();
        console.log('Hello from CustomPlugin');

        this.name = 'CustomPlugin';
        this._count = 10;

        setTimeout(this.count.bind(this), 1000);
    }

    /* You can add any functions and members you like */
    count() {
        setTimeout(() => {
            this._count--;
            if(this._count > 0) {
                this.count();
            } else {
                this._count = ':)';
            }
        }, 1000);
    }

    /* Use this function for drawing UI */
    draw() {
        ui.label(`Explosion in: ${this._count}`);
    }
}
